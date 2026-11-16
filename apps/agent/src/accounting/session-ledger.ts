import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {SessionAccountingPolicySchema,SessionReservationSchema,SessionReconciliationSchema,SessionAccountingEntrySchema,
 SessionAccountingSnapshotSchema,SessionReconciliationReceiptSchema,type SessionAccountingEntry,type SessionAccountingPolicy} from '../../../../packages/contracts/src/session-accounting.ts';
type SessionRow={session_id:string;policy:string;version:number;locked:number};
type EntryRow={body:string};
function fail(code:string):never{throw Error(code);}
const authority='host-supplied-not-vendor-verified' as const;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Operational accounting only. All entrypoints are trusted host APIs, never model tools. */
export function openSessionAccounting(path:string,options:{now?:()=>number}={}){
 const file=resolve(path);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())fail('SESSION_PATH_INVALID');
 const db=new Database(file,{create:true,strict:true});
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS accounting_sessions(session_id TEXT PRIMARY KEY,policy TEXT NOT NULL,version INTEGER NOT NULL,locked INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS accounting_attempts(session_id TEXT NOT NULL,attempt_id TEXT NOT NULL,operation_id TEXT NOT NULL,body TEXT NOT NULL,
 PRIMARY KEY(session_id,attempt_id),FOREIGN KEY(session_id) REFERENCES accounting_sessions(session_id));
 CREATE TABLE IF NOT EXISTS accounting_receipts(session_id TEXT NOT NULL,reconciliation_id TEXT NOT NULL,attempt_id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,
 PRIMARY KEY(session_id,reconciliation_id),UNIQUE(session_id,attempt_id),FOREIGN KEY(session_id) REFERENCES accounting_sessions(session_id));
 CREATE TABLE IF NOT EXISTS accounting_clock(id INTEGER PRIMARY KEY CHECK(id=1),at INTEGER NOT NULL);`);
 const time=()=>{const n=(options.now??Date.now)();if(!Number.isSafeInteger(n)||n<0)fail('SESSION_CLOCK_INVALID');
  if(!db.query('INSERT INTO accounting_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at WHERE at<=excluded.at RETURNING at').get(n))fail('SESSION_CLOCK_INVALID');return n;};
 const session=(id:string)=>{const row=db.query('SELECT * FROM accounting_sessions WHERE session_id=?').get(id) as SessionRow|null;return row??fail('SESSION_NOT_FOUND');};
 const entries=(id:string)=>(db.query('SELECT body FROM accounting_attempts WHERE session_id=? ORDER BY rowid').all(id) as EntryRow[])
  .map(r=>SessionAccountingEntrySchema.parse(JSON.parse(r.body)));
 const snapshot=(id:string)=>{const row=session(id),all=entries(id);const totals={callsConsumed:all.length,activeSlots:0,heldCostMicros:0,usedCostMicros:0};
  for(const e of all){if(['reserved','dispatched','unknown','responded'].includes(e.status)){if(e.status!=='responded')totals.activeSlots++;totals.heldCostMicros+=e.reservedCostMicros;}
   else if(e.status==='settled')totals.usedCostMicros+=e.actualCostMicros!;}
  return SessionAccountingSnapshotSchema.parse({schemaVersion:1,policy:JSON.parse(row.policy),version:row.version,locked:!!row.locked,authority,entries:all,totals});};
 const save=(entry:SessionAccountingEntry,lock=false)=>{db.query('UPDATE accounting_attempts SET body=? WHERE session_id=? AND attempt_id=?').run(JSON.stringify(entry),entry.sessionId,entry.attemptId);
  db.query('UPDATE accounting_sessions SET version=version+1,locked=MAX(locked,?) WHERE session_id=?').run(lock?1:0,entry.sessionId);return snapshot(entry.sessionId);};
 const find=(sessionId:string,attemptId:string)=>entries(sessionId).find(e=>e.attemptId===attemptId)??fail('SESSION_ATTEMPT_NOT_FOUND');
 function ensureSession(raw:unknown){return db.transaction(()=>{const policy=SessionAccountingPolicySchema.parse(raw),old=db.query('SELECT policy FROM accounting_sessions WHERE session_id=?').get(policy.sessionId) as {policy:string}|null;
  if(old){if(digest(JSON.parse(old.policy))!==digest(policy))fail('SESSION_POLICY_CONFLICT');return snapshot(policy.sessionId);}
  if(time()>=policy.deadlineAt)fail('SESSION_DEADLINE_EXCEEDED');db.query('INSERT INTO accounting_sessions VALUES(?,?,0,0)').run(policy.sessionId,JSON.stringify(policy));return snapshot(policy.sessionId);
 }).immediate();}
 function reserve(raw:unknown){return db.transaction(()=>{const request=SessionReservationSchema.parse(raw),s=snapshot(request.sessionId),p=s.policy;
  if(p.userId!==request.userId||p.roleId!==request.roleId)fail('SESSION_FORBIDDEN');
  if(s.entries.some(e=>e.attemptId===request.attemptId))fail('SESSION_ATTEMPT_REUSED');
  if(s.entries.some(e=>e.operationId===request.operationId&&e.status!=='released'))fail('SESSION_REPLAY_BLOCKED');
  if(s.locked)fail('SESSION_BUDGET_LOCKED');const at=time();if(at>=p.deadlineAt)fail('SESSION_DEADLINE_EXCEEDED');
  if(s.totals.callsConsumed>=p.maxCalls)fail('SESSION_CALL_BUDGET_EXCEEDED');
  if(s.totals.activeSlots>=p.maxConcurrent)fail('SESSION_CONCURRENCY_EXCEEDED');
  if(s.totals.heldCostMicros+s.totals.usedCostMicros+request.reservedCostMicros>p.maxCostMicros)fail('SESSION_COST_BUDGET_EXCEEDED');
  const e:SessionAccountingEntry={...request,status:'reserved',admittedAt:at};
  db.query('INSERT INTO accounting_attempts VALUES(?,?,?,?)').run(e.sessionId,e.attemptId,e.operationId,JSON.stringify(e));
  db.query('UPDATE accounting_sessions SET version=version+1 WHERE session_id=?').run(e.sessionId);return snapshot(e.sessionId);
 }).immediate();}
 function transition(sessionId:string,attemptId:string,to:'dispatched'|'unknown'|'responded'|'released'){
  return db.transaction(()=>{const s=snapshot(sessionId),e=find(sessionId,attemptId);time();
   if(e.status===to)return s;
   if(to==='dispatched'){if(s.locked)fail('SESSION_BUDGET_LOCKED');if(time()>=s.policy.deadlineAt)fail('SESSION_DEADLINE_EXCEEDED');}
   if(to==='unknown'||to==='responded'?e.status!=='dispatched':e.status!=='reserved')fail('SESSION_STATE_CONFLICT');e.status=to;return save(e);
  }).immediate();
 }
 function reconcile(raw:unknown){return db.transaction(()=>{const command=SessionReconciliationSchema.parse(raw),{expectedVersion:_,...identity}=command,key=digest(identity);
  const old=db.query('SELECT digest,receipt FROM accounting_receipts WHERE session_id=? AND (reconciliation_id=? OR attempt_id=?)').get(command.sessionId,command.reconciliationId,command.attemptId) as {digest:string;receipt:string}|null;
  if(old){if(old.digest!==key)fail('SESSION_RECONCILIATION_CONFLICT');return SessionReconciliationReceiptSchema.parse(JSON.parse(old.receipt));}
  const s=snapshot(command.sessionId);if(s.version!==command.expectedVersion)fail('SESSION_VERSION_CONFLICT');const e=find(command.sessionId,command.attemptId);
  if(!['dispatched','unknown','responded'].includes(e.status))fail('SESSION_STATE_CONFLICT');
  e.status='settled';e.actualCostMicros=command.actualCostMicros;e.evidence=command.evidence;
  const next=save(e,command.actualCostMicros>e.reservedCostMicros||s.totals.usedCostMicros+s.totals.heldCostMicros-e.reservedCostMicros+command.actualCostMicros>s.policy.maxCostMicros);
  const receipt=SessionReconciliationReceiptSchema.parse({...command,fromVersion:s.version,toVersion:next.version,reconciledAt:time(),authority});
  db.query('INSERT INTO accounting_receipts VALUES(?,?,?,?,?)').run(command.sessionId,command.reconciliationId,command.attemptId,key,JSON.stringify(receipt));return receipt;
 }).immediate();}
 function recoverExpired(at?:number){return db.transaction(()=>{const cutoff=at??time();if(!Number.isSafeInteger(cutoff)||cutoff<0)fail('SESSION_CLOCK_INVALID');let changed=0;
  for(const r of db.query('SELECT * FROM accounting_sessions').all() as SessionRow[]){const policy=SessionAccountingPolicySchema.parse(JSON.parse(r.policy));if(policy.deadlineAt>cutoff)continue;
   for(const e of entries(r.session_id)){if(e.status==='reserved'){e.status='released';save(e);changed++;}else if(e.status==='dispatched'){e.status='unknown';save(e);changed++;}}}return changed;
 }).immediate();}
 return {ensureSession,reserve,dispatch:(sessionId:string,attemptId:string)=>transition(sessionId,attemptId,'dispatched'),
  markUnknown:(sessionId:string,attemptId:string)=>transition(sessionId,attemptId,'unknown'),completeResponse:(sessionId:string,attemptId:string)=>transition(sessionId,attemptId,'responded'),
  release:(sessionId:string,attemptId:string)=>transition(sessionId,attemptId,'released'),
  reconcile,recoverExpired,snapshot:(id:string)=>db.transaction(()=>snapshot(id)).deferred(),close:()=>db.close(),path:file};
}
export type SessionAccounting=ReturnType<typeof openSessionAccounting>;
