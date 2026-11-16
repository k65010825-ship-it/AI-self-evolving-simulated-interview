import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {LocalError,type LocalProfile} from './profile-store.ts';
import {LocalSessionBudgetSchema,LocalSessionBudgetLimitsSchema,LocalLiveGrantInputSchema,LocalLiveGrantSchema,LocalLiveReconciliationSchema,type LocalSessionBudget,type LocalLiveGrant} from '../../../../packages/contracts/src/local-live.ts';
import {LiveModelProfileSchema,ModelBudgetSnapshotSchema} from '../../../../packages/contracts/src/model-access.ts';
import {LiveServiceConfigSchema} from '../../../../packages/contracts/src/live-model.ts';
import {createModelBudgetGate} from '../model-access/budget.ts';
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fail(c:string):never{throw new LocalError(c);}
type Snapshot=z.infer<typeof ModelBudgetSnapshotSchema>;
type Row={session_id:string;job_id:string;run_id:string;attempt_id:string;grant_id:string;snapshot:string;profile:string};
type Binding={sessionId:string;jobId:string;grantId:string};
type Checkpoint=Binding&{runId:string;attemptId:string;snapshot:unknown;profile:unknown};
/** Host-only persistent accounting; no credentials and no model result commits. */
export function createLocalLiveStore(profile:LocalProfile,options:{now?:()=>number}={}){
 const clock=options.now??Date.now;
 const time=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0)fail('LOCAL_CLOCK_INVALID');return n;};
 const budgetIn=(db:Database,id:string):LocalSessionBudget|null=>{const r=db.query('SELECT body FROM local_session_budgets WHERE session_id=?').get(id) as {body:string}|null;return r?LocalSessionBudgetSchema.parse(JSON.parse(r.body)):null;};
 const grantIn=(db:Database,id:string):LocalLiveGrant|null=>{const r=db.query('SELECT g.body FROM local_session_budgets b JOIN local_live_grants g ON b.current_grant=g.grant_id WHERE b.session_id=? AND g.revoked=0').get(id) as {body:string}|null;return r?LocalLiveGrantSchema.parse(JSON.parse(r.body)):null;};
 const rows=(db:Database,id?:string)=>db.query('SELECT * FROM local_model_checkpoints'+(id?' WHERE session_id=?':'')).all(...(id?[id]:[])) as Row[];
 const totalsIn=(db:Database,id:string)=>{const t={callsConsumed:0,activeSlots:0,heldTokens:0,usedTokens:0,heldCostMicros:0,usedCostMicros:0};for(const row of rows(db,id)){const s=ModelBudgetSnapshotSchema.parse(JSON.parse(row.snapshot));for(const key of Object.keys(t) as (keyof typeof t)[])t[key]+=s.totals[key];}return t;};
 const speechRows=(db:Database,id?:string)=>(db.query('SELECT body FROM local_speech_attempts'+(id?' WHERE session_id=?':'')).all(...(id?[id]:[])) as {body:string}[]).map(r=>JSON.parse(r.body) as {status:string;reservedCostMicros:number});
 const resourceCheck=(db:Database,id:string)=>{const row=db.query('SELECT body FROM local_resource_budgets WHERE session_id=?').get(id) as {body:string}|null;if(!row)return;const cap=(JSON.parse(row.body) as {totalMaxCostMicros:number}).totalMaxCostMicros,t=totalsIn(db,id);if(t.heldCostMicros+t.usedCostMicros+speechRows(db,id).filter(a=>a.status!=='released').reduce((n,a)=>n+a.reservedCostMicros,0)>cap)fail('MODEL_SESSION_BUDGET_EXCEEDED');};
 const blockedIn=(db:Database)=>!!db.query("SELECT 1 FROM local_budget WHERE status IN ('unknown','dispatched') LIMIT 1").get()||speechRows(db).some(a=>a.status==='unknown')||rows(db).some(r=>ModelBudgetSnapshotSchema.parse(JSON.parse(r.snapshot)).entries.some(e=>e.status==='unknown'));
 function dispatchIn(db:Database,b:Binding){const budget=budgetIn(db,b.sessionId)??fail('LOCAL_BUDGET_REQUIRED'),grant=grantIn(db,b.sessionId);if(!grant||grant.grantId!==b.grantId||grant.expiresAt<=time())fail('LOCAL_GRANT_INACTIVE');if(blockedIn(db))fail('BUDGET_RECONCILIATION_REQUIRED');
  const job=db.query('SELECT session_id,status FROM local_jobs WHERE job_id=?').get(b.jobId) as {session_id:string;status:string}|null;
  if(!job||job.session_id!==b.sessionId||job.status!=='running')fail('LOCAL_LIVE_BINDING_INVALID');
  const session=db.query('SELECT deadline_at FROM local_sessions WHERE session_id=?').get(b.sessionId) as {deadline_at:number}|null;if(!session||session.deadline_at<=time())fail('LOCAL_GRANT_INACTIVE');
  resourceCheck(db,b.sessionId);if(rows(db,b.sessionId).some(r=>ModelBudgetSnapshotSchema.parse(JSON.parse(r.snapshot)).locked))fail('MODEL_BUDGET_LOCKED');return{budget,grant};
 }
 function createSessionBudget(input:{sessionId:string;profile:unknown;limits?:unknown;serviceConfig?:unknown}){return profile.write(db=>{
  const p=LiveModelProfileSchema.parse(input.profile),limits=LocalSessionBudgetLimitsSchema.parse(input.limits??{maxCalls:p.limits.maxCalls,maxTotalTokens:p.limits.maxTotalTokens,maxCostMicros:p.limits.maxCostMicros});
  if(limits.maxCalls>p.limits.maxCalls||limits.maxTotalTokens>p.limits.maxTotalTokens||limits.maxCostMicros>p.limits.maxCostMicros)fail('LOCAL_BUDGET_CONFLICT');
  const cfg=input.serviceConfig===undefined?undefined:LiveServiceConfigSchema.parse(input.serviceConfig);if(cfg&&!same(cfg.profile,p))fail('LOCAL_BUDGET_CONFLICT');
  if(cfg){cfg.authorization.enabled=false;cfg.authorization.operatorApproved=false;}
  const b=LocalSessionBudgetSchema.parse({sessionId:input.sessionId,profile:p,profileDigest:hash(p),currency:p.pricing.currency,pricingVersion:p.pricing.version,limits,...(cfg?{serviceConfig:cfg}:{})});
  if(!db.query('SELECT 1 FROM local_sessions WHERE session_id=?').get(b.sessionId))fail('LOCAL_LIVE_BINDING_INVALID');
  const old=budgetIn(db,b.sessionId);if(old){if(!same(old,b))fail('LOCAL_BUDGET_CONFLICT');return old;}
  db.query('INSERT INTO local_session_budgets(session_id,body) VALUES(?,?)').run(b.sessionId,JSON.stringify(b));return b;
 });}
 function authorize(raw:unknown){return profile.write(db=>{const i=LocalLiveGrantInputSchema.parse(raw),b=budgetIn(db,i.sessionId)??fail('LOCAL_BUDGET_REQUIRED');if(hash(i.profile)!==b.profileDigest||i.expiresAt<=time())fail('LOCAL_GRANT_INVALID');
  const r=db.query('SELECT grant_version FROM local_session_budgets WHERE session_id=?').get(i.sessionId) as {grant_version:number};if(r.grant_version!==i.expectedVersion)fail('LOCAL_GRANT_CONFLICT');
  const old=grantIn(db,i.sessionId);if(old&&i.expiresAt<old.expiresAt)fail('LOCAL_GRANT_INVALID');if(db.query('SELECT 1 FROM local_live_grants WHERE grant_id=? UNION ALL SELECT 1 FROM local_speech_grants WHERE grant_id=?').get(i.grantId,i.grantId))fail('LOCAL_GRANT_CONFLICT');
  const {expectedVersion:_,...input}=i,g=LocalLiveGrantSchema.parse({...input,version:r.grant_version+1,profileDigest:b.profileDigest});
  db.query('UPDATE local_live_grants SET revoked=1 WHERE session_id=?').run(i.sessionId);db.query('INSERT INTO local_live_grants VALUES(?,?,?,?,0)').run(g.grantId,g.sessionId,g.version,JSON.stringify(g));
  db.query('UPDATE local_session_budgets SET current_grant=?,grant_version=? WHERE session_id=?').run(g.grantId,g.version,g.sessionId);return g;
 });}
 function revoke(raw:{sessionId:string;expectedVersion:number}){return profile.write(db=>{const r=db.query('SELECT grant_version FROM local_session_budgets WHERE session_id=?').get(raw.sessionId) as {grant_version:number}|null;if(!r||r.grant_version!==raw.expectedVersion)fail('LOCAL_GRANT_CONFLICT');db.query('UPDATE local_live_grants SET revoked=1 WHERE session_id=?').run(raw.sessionId);db.query('UPDATE local_session_budgets SET current_grant=NULL,grant_version=grant_version+1 WHERE session_id=?').run(raw.sessionId);return{version:r.grant_version+1};});}
 function checkpoint(input:Checkpoint){return profile.write(db=>{const s=ModelBudgetSnapshotSchema.parse(input.snapshot),p=LiveModelProfileSchema.parse(input.profile),b=budgetIn(db,input.sessionId)??fail('LOCAL_BUDGET_REQUIRED');
  if(input.jobId!==input.runId||hash(p)!==b.profileDigest||s.profileDigest!==b.profileDigest)fail('LOCAL_LIVE_BINDING_INVALID');
  const grant=db.query('SELECT session_id,body FROM local_live_grants WHERE grant_id=?').get(input.grantId) as {session_id:string;body:string}|null;if(!grant||grant.session_id!==input.sessionId)fail('LOCAL_LIVE_BINDING_INVALID');
  const j=db.query('SELECT session_id,request,role_id FROM local_jobs WHERE job_id=?').get(input.jobId) as {session_id:string;request:string;role_id:string}|null;
  if(!j||j.session_id!==input.sessionId)fail('LOCAL_LIVE_BINDING_INVALID');const ctx=JSON.parse(j.request).context;
  const matches=(a:string,e:string)=>a===e||a===hash(e).slice(0,40);
  if(!ctx||ctx.runId!==input.runId||ctx.attemptId!==input.attemptId||!matches(s.scope.runId,input.runId)||!matches(s.scope.attemptId,input.attemptId)||!matches(s.scope.userId,profile.profileId)||s.scope.roleId!==j.role_id||s.scope.deadlineAt>Math.min(ctx.deadlineAt,JSON.parse(grant.body).expiresAt))fail('LOCAL_LIVE_BINDING_INVALID');
  createModelBudgetGate(p,s.scope,{restore:s,now:time});
  const old=db.query('SELECT * FROM local_model_checkpoints WHERE run_id=? AND attempt_id=?').get(input.runId,input.attemptId) as Row|null;const previous=old?ModelBudgetSnapshotSchema.parse(JSON.parse(old.snapshot)):null;
  if(old&&(old.job_id!==input.jobId||old.session_id!==input.sessionId||old.grant_id!==input.grantId))fail('LOCAL_LIVE_BINDING_INVALID');
  if(previous&&s.version===previous.version&&same(s,previous))return previous;
  if(s.version!==(previous?.version??0)+1)fail('LOCAL_CHECKPOINT_CONFLICT');
  if(previous&&!same(previous.scope,s.scope))fail('LOCAL_CHECKPOINT_CONFLICT');
  const before=new Map(previous?.entries.map(e=>[e.callId,e])??[]);let changed=0,admission=false;
  const transitions:Record<string,string[]>={reserved:['dispatched','released'],dispatched:['unknown','settled','rejected'],unknown:['settled'],rejected:['settled'],settled:[],released:[]};
  for(const e of s.entries){const prior=before.get(e.callId);if(!prior){if(e.status!=='reserved')fail('LOCAL_CHECKPOINT_CONFLICT');changed++;admission=true;continue;}before.delete(e.callId);if(same(prior,e))continue;if(!same(prior.planned,e.planned)||prior.reservedCostMicros!==e.reservedCostMicros||!transitions[prior.status]!.includes(e.status))fail('LOCAL_CHECKPOINT_CONFLICT');changed++;if(e.status==='dispatched')admission=true;}
  if(before.size||changed!==1||previous?.locked&&!s.locked)fail('LOCAL_CHECKPOINT_CONFLICT');if(admission)dispatchIn(db,input);
  db.query('INSERT INTO local_model_checkpoints VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,attempt_id) DO UPDATE SET snapshot=excluded.snapshot').run(input.jobId,input.runId,input.attemptId,input.sessionId,input.grantId,JSON.stringify(s),JSON.stringify(p));
  const totals=totalsIn(db,input.sessionId);if(admission){if(totals.callsConsumed>b.limits.maxCalls||totals.usedTokens+totals.heldTokens>b.limits.maxTotalTokens||totals.usedCostMicros+totals.heldCostMicros>b.limits.maxCostMicros)fail('MODEL_SESSION_BUDGET_EXCEEDED');resourceCheck(db,input.sessionId);}return s;
 });}
 function recover(){return profile.write(db=>{let count=0;for(const row of rows(db)){const s=ModelBudgetSnapshotSchema.parse(JSON.parse(row.snapshot)),g=createModelBudgetGate(JSON.parse(row.profile),s.scope,{restore:s,now:time});for(const e of s.entries){if(e.status==='dispatched'){g.markUnknown(e.callId);count++;}if(e.status==='reserved'){g.release(e.callId);count++;}}db.query('UPDATE local_model_checkpoints SET snapshot=? WHERE run_id=? AND attempt_id=?').run(JSON.stringify(g.snapshot()),row.run_id,row.attempt_id);}return count;});}
 function reconcile(raw:unknown){return profile.write(db=>{const i=LocalLiveReconciliationSchema.parse(raw),d=hash({...i,expectedVersion:null}),prior=db.query('SELECT digest,receipt FROM local_live_reconciliations WHERE run_id=? AND attempt_id=? AND call_id=?').get(i.runId,i.attemptId,i.callId) as {digest:string;receipt:string}|null;
  if(prior){if(prior.digest!==d)fail('LOCAL_RECONCILIATION_CONFLICT');return JSON.parse(prior.receipt);}
  const row=db.query('SELECT * FROM local_model_checkpoints WHERE run_id=? AND attempt_id=?').get(i.runId,i.attemptId) as Row|null;if(!row||row.session_id!==i.sessionId||row.job_id!==i.jobId)fail('LOCAL_LIVE_BINDING_INVALID');
  const job=db.query('SELECT status FROM local_jobs WHERE job_id=?').get(i.jobId) as {status:string}|null;if(!job||['queued','running'].includes(job.status))fail('LOCAL_TASK_ACTIVE');
  const s=ModelBudgetSnapshotSchema.parse(JSON.parse(row.snapshot));if(s.version!==i.expectedVersion||!s.entries.some(e=>e.callId===i.callId&&['unknown','rejected'].includes(e.status)))fail('LOCAL_RECONCILIATION_CONFLICT');
  const g=createModelBudgetGate(JSON.parse(row.profile),s.scope,{restore:s,now:time});g.settle(i.callId,i.usage);const receipt={...i,toVersion:g.snapshot().version,reconciledAt:time(),authority:'host-supplied-usage-not-vendor-verified'};
  db.query('UPDATE local_model_checkpoints SET snapshot=? WHERE run_id=? AND attempt_id=?').run(JSON.stringify(g.snapshot()),i.runId,i.attemptId);db.query('INSERT INTO local_live_reconciliations VALUES(?,?,?,?,?)').run(i.runId,i.attemptId,i.callId,d,JSON.stringify(receipt));return receipt;
 });}
 // Construct only at host startup: recover all jobs, including already terminal jobs.
 recover();
 return{createSessionBudget,authorize,revoke,checkpoint,recover,reconcile,
  budget:(sessionId:string)=>profile.read(db=>budgetIn(db,sessionId)),activeGrant:(sessionId:string)=>profile.read(db=>grantIn(db,sessionId)),
  totals:(sessionId:string)=>profile.read(db=>totalsIn(db,sessionId)),canDispatch:(binding:Binding)=>profile.read(db=>{dispatchIn(db,binding);return true;}),
  hasBlockedAccounting:()=>profile.read(blockedIn),checkpoints:()=>profile.read(db=>rows(db).map(r=>({sessionId:r.session_id,jobId:r.job_id,grantId:r.grant_id,runId:r.run_id,attemptId:r.attempt_id,snapshot:ModelBudgetSnapshotSchema.parse(JSON.parse(r.snapshot))}))) };
}
export type LocalLiveStore=ReturnType<typeof createLocalLiveStore>;
