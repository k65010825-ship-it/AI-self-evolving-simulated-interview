import{Database}from'bun:sqlite';
import{createHash}from'node:crypto';
import{mkdirSync,existsSync,lstatSync}from'node:fs';import{dirname,resolve}from'node:path';
import{z}from'zod';
import{AgentRunRequestSchema,AgentRunSnapshotSchema,AgentRunEventSchema,type AgentRunSnapshot,type AgentRunEvent}from'../../../../packages/contracts/src/agent-run.ts';
import{DurableTaskSchema,BudgetReconciliationSchema,BudgetReconciliationReceiptSchema}from'../../../../packages/contracts/src/durable-runtime.ts';
import{ModelAccessProfileSchema,ModelBudgetSnapshotSchema}from'../../../../packages/contracts/src/model-access.ts';
import{workflowCommitDigest as digest}from'../../../../packages/agent-client/src/workflow-commit.ts';
import{createModelBudgetGate}from'../model-access/budget.ts';
import{describeError}from'../../../../packages/contracts/src/errors.ts';
type Row={run_id:string;request:string;digest:string;status:string;owner:string;fence:number;lease_until:number;snapshot:string|null};
type Ledger={snapshot:string;profile:string};
function fail(code:string):never{throw Error(code);}
/** Agent operational SQLite only. Business ownership, formal workflow commits and vendor billing remain API duties. */
export function openDurableStore(path:string,options:{ownerId:string;now?:()=>number;leaseMs?:number}){
 const cfg=z.object({ownerId:z.string().min(1).max(100),leaseMs:z.number().int().min(1).max(120000).default(61000)}).parse(options),clock=options.now??Date.now;
 const file=resolve(path);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())fail('DURABLE_PATH_INVALID');
 const db=new Database(file,{create:true,strict:true});db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 db.exec(`CREATE TABLE IF NOT EXISTS agent_tasks(run_id TEXT PRIMARY KEY,request TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,owner TEXT NOT NULL,fence INTEGER NOT NULL,lease_until INTEGER NOT NULL,snapshot TEXT);
 CREATE TABLE IF NOT EXISTS agent_events(run_id TEXT NOT NULL,seq INTEGER NOT NULL,event TEXT NOT NULL,PRIMARY KEY(run_id,seq),FOREIGN KEY(run_id) REFERENCES agent_tasks(run_id));
 CREATE TABLE IF NOT EXISTS agent_budgets(run_id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,profile TEXT NOT NULL,FOREIGN KEY(run_id) REFERENCES agent_tasks(run_id));
 CREATE TABLE IF NOT EXISTS agent_meta(name TEXT PRIMARY KEY,value INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS agent_authorizations(grant_key TEXT PRIMARY KEY,used_runs INTEGER NOT NULL,max_runs INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS agent_reconciliations(run_id TEXT NOT NULL,call_id TEXT NOT NULL,command_digest TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(run_id,call_id));`);
 const time=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0)fail('DURABLE_CLOCK_INVALID');
  const updated=db.query("INSERT INTO agent_meta VALUES('clock',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value WHERE value<=excluded.value RETURNING value").get(n);
  if(!updated)fail('DURABLE_CLOCK_INVALID');return n;};
 const rawTask=(id:string)=>db.query('SELECT * FROM agent_tasks WHERE run_id=?').get(id)as Row|null;
 const task=(id:string)=>{const r=rawTask(id);if(!r)return null;const t=DurableTaskSchema.parse({request:JSON.parse(r.request),requestDigest:r.digest,status:r.status,ownerId:r.owner,fence:r.fence,
  leaseUntil:r.lease_until,snapshot:r.snapshot?JSON.parse(r.snapshot):null});
  if(t.request.context.runId!==id||digest(t.request)!==t.requestDigest||t.snapshot&&(t.snapshot.runId!==id||t.snapshot.attemptId!==t.request.context.attemptId||t.snapshot.inputSnapshotId!==t.request.inputSnapshotId))fail('DURABLE_BINDING_INVALID');return t;};
 const accounting=()=> (db.query('SELECT run_id,snapshot FROM agent_budgets ORDER BY run_id').all()as{run_id:string;snapshot:string}[]).map(r=>({runId:r.run_id,snapshot:ModelBudgetSnapshotSchema.parse(JSON.parse(r.snapshot))}));
 const checkOwner=(id:string,fence:number)=>{const r=rawTask(id);if(!r||r.owner!==cfg.ownerId||r.fence!==fence||r.lease_until<=time())fail('DURABLE_FENCED');return r;};
 function enqueue(raw:unknown){return db.transaction(()=>{
  const request=AgentRunRequestSchema.parse(raw),id=request.context.runId,d=digest(request),old=rawTask(id);
  if(old){if(old.digest!==d)fail('DURABLE_REQUEST_CONFLICT');return task(id)!;}
  if(time()>=request.context.deadlineAt)fail('DURABLE_EXPIRED');
  db.query('INSERT INTO agent_tasks VALUES(?,?,?,?,?,?,?,NULL)').run(id,JSON.stringify(request),d,'queued',cfg.ownerId,0,0);return task(id)!;
 }).immediate();}
 function claim(id:string,grant?:{key:string;maxRuns:number}){return db.transaction(()=>{
  const r=rawTask(id);if(!r||r.status!=='queued')fail('DURABLE_TASK_NOT_QUEUED');const n=time();
  if(n>=AgentRunRequestSchema.parse(JSON.parse(r.request)).context.deadlineAt)fail('DURABLE_EXPIRED');
  if(grant){z.object({key:z.string().regex(/^[a-f0-9]{64}$/),maxRuns:z.number().int().min(1).max(32)}).strict().parse(grant);
   const admitted=db.query('INSERT INTO agent_authorizations VALUES(?,1,?) ON CONFLICT(grant_key) DO UPDATE SET used_runs=used_runs+1 WHERE used_runs<max_runs AND max_runs=excluded.max_runs RETURNING used_runs').get(grant.key,grant.maxRuns);
   if(!admitted)fail('DURABLE_RUN_LIMIT');
  }
  db.query('UPDATE agent_tasks SET status=?,owner=?,fence=?,lease_until=? WHERE run_id=?').run('running',cfg.ownerId,r.fence+1,n+cfg.leaseMs,id);return r.fence+1;
 }).immediate();}
 function checkpointRun(id:string,fence:number,rawSnapshot:unknown,rawEvent:unknown){db.transaction(()=>{
  const r=checkOwner(id,fence),s=AgentRunSnapshotSchema.parse(rawSnapshot),event=AgentRunEventSchema.parse(rawEvent),request=AgentRunRequestSchema.parse(JSON.parse(r.request));
  if(s.runId!==id||s.attemptId!==request.context.attemptId||event.runId!==id||event.attemptId!==s.attemptId||s.inputSnapshotId!==request.inputSnapshotId||event.seq!==s.lastEventSeq)fail('DURABLE_BINDING_INVALID');
  const previous=r.snapshot?AgentRunSnapshotSchema.parse(JSON.parse(r.snapshot)):null;
  // Result/event terminality is immutable; owned late usage settles via checkpointBudget separately.
  if(r.status!=='running'||previous&&['completed','failed','cancelled'].includes(previous.status))fail('DURABLE_TERMINAL');
  if(event.seq!==(previous?.lastEventSeq??0)+1||previous&&Date.parse(s.updatedAt)<Date.parse(previous.updatedAt))fail('DURABLE_EVENT_CONFLICT');
  db.query('INSERT INTO agent_events VALUES(?,?,?)').run(id,event.seq,JSON.stringify(event));
  // queued is an in-memory admission phase; the durable lease has already claimed this run.
  db.query('UPDATE agent_tasks SET status=?,snapshot=? WHERE run_id=?').run(s.status==='queued'?'running':s.status,JSON.stringify(s),id);
 }).immediate();}
 function checkpointBudget(id:string,fence:number,rawSnapshot:unknown,rawProfile:unknown){db.transaction(()=>{
  const taskRow=checkOwner(id,fence),request=AgentRunRequestSchema.parse(JSON.parse(taskRow.request)),pseudo=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,40);
  const snapshot=ModelBudgetSnapshotSchema.parse(rawSnapshot),profile=ModelAccessProfileSchema.parse(rawProfile);
  if(snapshot.scope.runId!==pseudo(request.context.runId)||snapshot.scope.attemptId!==pseudo(request.context.attemptId)||snapshot.scope.userId!==pseudo(request.context.userId)||snapshot.scope.roleId!==request.context.roleId||snapshot.scope.deadlineAt>request.context.deadlineAt)fail('DURABLE_BINDING_INVALID');
  createModelBudgetGate(profile,snapshot.scope,{restore:snapshot,now:time});
  const old=db.query('SELECT snapshot,profile FROM agent_budgets WHERE run_id=?').get(id)as Ledger|null;
  if(old){const s=ModelBudgetSnapshotSchema.parse(JSON.parse(old.snapshot));
   if(digest(profile)!==digest(JSON.parse(old.profile))||snapshot.version!==s.version+1)fail('DURABLE_BUDGET_CONFLICT');
  }else if(snapshot.version!==1)fail('DURABLE_BUDGET_CONFLICT');
  db.query('INSERT INTO agent_budgets VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET snapshot=excluded.snapshot').run(id,JSON.stringify(snapshot),JSON.stringify(profile));
 }).immediate();}
 function recoverExpired(){return db.transaction(()=>{
  let recovered=0;for(const r of db.query("SELECT * FROM agent_tasks WHERE lease_until>0 AND lease_until<=?").all(time())as Row[]){
   const ledger=db.query('SELECT snapshot,profile FROM agent_budgets WHERE run_id=?').get(r.run_id)as Ledger|null;
   const storedLedger=ledger?ModelBudgetSnapshotSchema.parse(JSON.parse(ledger.snapshot)):null;
   if(r.status!=='running'&&!storedLedger?.entries.some(e=>e.status==='dispatched'||e.status==='reserved'))continue;
   const request=AgentRunRequestSchema.parse(JSON.parse(r.request)),at=time(),previous=r.snapshot?AgentRunSnapshotSchema.parse(JSON.parse(r.snapshot)):null;
   if(r.status==='running'){
   const {status:_status,...error}=describeError('DEPENDENCY_UNAVAILABLE');
   const snapshot=AgentRunSnapshotSchema.parse({...previous,runId:r.run_id,attemptId:request.context.attemptId,inputSnapshotId:request.inputSnapshotId,status:'failed',stage:null,result:null,error,
    createdAt:previous?.createdAt??new Date(at).toISOString(),updatedAt:new Date(at).toISOString(),lastEventSeq:(previous?.lastEventSeq??0)+1});
   const event=AgentRunEventSchema.parse({schemaVersion:1,runId:r.run_id,attemptId:request.context.attemptId,seq:snapshot.lastEventSeq,occurredAt:snapshot.updatedAt,type:'run.failed',payload:{error}});
   db.query('INSERT INTO agent_events VALUES(?,?,?)').run(r.run_id,event.seq,JSON.stringify(event));
   db.query("UPDATE agent_tasks SET status='interrupted',fence=fence+1,snapshot=? WHERE run_id=?").run(JSON.stringify(snapshot),r.run_id);
   }else db.query('UPDATE agent_tasks SET fence=fence+1 WHERE run_id=?').run(r.run_id);
   if(ledger){const s=ModelBudgetSnapshotSchema.parse(JSON.parse(ledger.snapshot)),g=createModelBudgetGate(JSON.parse(ledger.profile),s.scope,{restore:s,now:time});
    for(const e of s.entries){if(e.status==='dispatched')g.markUnknown(e.callId);if(e.status==='reserved')g.release(e.callId);}
    db.query('UPDATE agent_budgets SET snapshot=? WHERE run_id=?').run(JSON.stringify(g.snapshot()),r.run_id);
   }recovered++;
  }return recovered;
 }).immediate();}
 function reconcile(raw:unknown){return db.transaction(()=>{
  const i=BudgetReconciliationSchema.parse(raw),r=task(i.runId);if(!r)fail('DURABLE_NOT_FOUND');
  if(r.request.context.userId!==i.identity.userId||r.request.context.roleId!==i.identity.roleId||r.request.context.attemptId!==i.attemptId)fail('DURABLE_FORBIDDEN');
  const commandDigest=digest({...i,expectedVersion:null}),old=db.query('SELECT command_digest,receipt FROM agent_reconciliations WHERE run_id=? AND call_id=?').get(i.runId,i.callId)as{command_digest:string;receipt:string}|null;
  if(old){if(old.command_digest!==commandDigest)fail('DURABLE_RECONCILIATION_CONFLICT');return{kind:'replayed' as const,receipt:BudgetReconciliationReceiptSchema.parse(JSON.parse(old.receipt))};}
  if(r.status==='queued'||r.status==='running')fail('DURABLE_TASK_ACTIVE');
  const ledger=db.query('SELECT snapshot,profile FROM agent_budgets WHERE run_id=?').get(i.runId)as Ledger|null;if(!ledger)fail('DURABLE_NOT_FOUND');
  const s=ModelBudgetSnapshotSchema.parse(JSON.parse(ledger.snapshot));if(s.version!==i.expectedVersion)fail('DURABLE_BUDGET_CONFLICT');
  const e=s.entries.find(e=>e.callId===i.callId);if(!e||!['unknown','rejected'].includes(e.status))fail('DURABLE_RECONCILIATION_CONFLICT');
  const gate=createModelBudgetGate(JSON.parse(ledger.profile),s.scope,{restore:s,now:time});gate.settle(i.callId,i.usage);
  const receipt=BudgetReconciliationReceiptSchema.parse({runId:i.runId,callId:i.callId,usage:i.usage,evidenceRef:i.evidenceRef,fromVersion:s.version,toVersion:gate.snapshot().version,reconciledAt:time(),authority:'host-supplied-usage-not-vendor-verified'});
  db.query('UPDATE agent_budgets SET snapshot=? WHERE run_id=?').run(JSON.stringify(gate.snapshot()),i.runId);
  db.query('INSERT INTO agent_reconciliations VALUES(?,?,?,?)').run(i.runId,i.callId,commandDigest,JSON.stringify(receipt));return{kind:'reconciled' as const,receipt};
 }).immediate();}
 function abandon(id:string,fence:number){db.transaction(()=>{checkOwner(id,fence);db.query('UPDATE agent_tasks SET lease_until=1 WHERE run_id=?').run(id);}).immediate();recoverExpired();}
 return{enqueue,claim,task,checkpointRun,checkpointBudget,recoverExpired,reconcile,accounting,abandon,
  isOwner:(id:string,fence:number)=>{try{checkOwner(id,fence);return true;}catch{return false;}},
  hasBlockedAccounting:()=>accounting().some(a=>a.snapshot.locked||a.snapshot.entries.some(e=>e.status==='unknown'||e.status==='dispatched')),
  events:(id:string,after=0)=> (db.query('SELECT event FROM agent_events WHERE run_id=? AND seq>? ORDER BY seq').all(id,after)as{event:string}[]).map(r=>AgentRunEventSchema.parse(JSON.parse(r.event))),
  close:()=>db.close(),path:file};
}
