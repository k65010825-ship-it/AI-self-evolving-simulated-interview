import {Database} from 'bun:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,existsSync,lstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {AgentRunRequestSchema,type AgentRunRequest} from '../../../../packages/contracts/src/agent-run.ts';
import {LiveServiceConfigSchema} from '../../../../packages/contracts/src/live-model.ts';
import {workflowCommitDigest as digest} from '../../../../packages/agent-client/src/workflow-commit.ts';
import {createSessionCheckpointAdapter} from '../accounting/checkpoint-adapter.ts';
import type {SessionAccounting} from '../accounting/session-ledger.ts';
import {estimateCostMicros} from '../model-access/preflight.ts';
import type {LiveModelDependencies} from '../model-access/bailian-provider.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {createDurableLiveRunManager} from './durable-runtime.ts';
type Binding={run_id:string;session_id:string;user_id:string;role_id:string;request_digest:string};
/** API-owned business scope is retained separately from pseudonymous per-run model accounting. */
export function createPilotAgentRuntime(options:{path:string;bindingsPath:string;ledger:SessionAccounting;liveConfig:unknown;
 readCredential:LiveModelDependencies['readCredential'];fetch?:LiveModelDependencies['fetch'];now?:()=>number;ownerId?:string}){
 const config=LiveServiceConfigSchema.parse(options.liveConfig),clock=options.now??Date.now;
 if(typeof options.readCredential!=='function')throw new AgentStateError('VALIDATION_ERROR');
 const file=resolve(options.bindingsPath);mkdirSync(dirname(file),{recursive:true});
 if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new AgentStateError('VALIDATION_ERROR');
 const db=new Database(file,{create:true,strict:true});
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS pilot_run_bindings(run_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,request_digest TEXT NOT NULL);`);
 const binding=(id:string)=>db.query('SELECT * FROM pilot_run_bindings WHERE run_id=?').get(id) as Binding|null;
 const adapters=new Map<string,ReturnType<typeof createSessionCheckpointAdapter>>();
 function adapter(b:Binding){let a=adapters.get(b.run_id);if(!a){a=createSessionCheckpointAdapter({ledger:options.ledger,
  binding:{sessionId:b.session_id,userId:b.user_id,roleId:b.role_id,runId:b.run_id},pricing:{source:`${config.profile.pricing.provenance}:${config.profile.providerId}:${config.profile.modelId}:${config.profile.pricing.id}`,
   version:config.profile.pricing.version,unit:'token'}});adapters.set(b.run_id,a);}return a;}
 function validateScope(request:AgentRunRequest){
  if(request.job.type!=='workflow')throw new AgentStateError('VALIDATION_ERROR');
  const op=request.job.operation,scope=op.action==='create'?{identity:op.config.identity,sessionId:op.config.session.sessionId}: {identity:op.snapshot.identity,sessionId:op.snapshot.state.sessionId};
  if(scope.identity.userId!==request.context.userId)throw new AgentStateError('FORBIDDEN');
  if(scope.identity.roleId!==request.context.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  let policy;try{policy=options.ledger.snapshot(scope.sessionId).policy;}catch{throw new AgentStateError('FORBIDDEN');}
  if(policy.userId!==request.context.userId)throw new AgentStateError('FORBIDDEN');
  if(policy.roleId!==request.context.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if(policy.currency!==config.profile.pricing.currency)throw new AgentStateError('VALIDATION_ERROR');
  return scope;
 }
 let durable:ReturnType<typeof createDurableLiveRunManager>;
 try{durable=createDurableLiveRunManager(config,{readCredential:options.readCredential,...(options.fetch?{fetch:options.fetch}:{}),now:clock,
  canDispatchRun:context=>{
   const b=binding(context.runId);if(!b||b.user_id!==context.userId||b.role_id!==context.roleId)return false;
   try{const s=options.ledger.snapshot(b.session_id),t=s.totals,p=s.policy;
    const cost=estimateCostMicros(config.profile.pricing.rates,config.profile.limits.maxInputTokens,config.recovery.initialOutputTokens??config.profile.limits.maxOutputTokens);
    return !s.locked&&clock()<p.deadlineAt&&!s.entries.some(e=>e.status==='unknown')&&t.callsConsumed<p.maxCalls&&t.activeSlots<p.maxConcurrent
     &&t.usedCostMicros+t.heldCostMicros+Math.max(1,cost)<=p.maxCostMicros;
   }catch{return false;}
  },
  onBudgetCheckpoint:(context,snapshot,profile)=>{
   const b=binding(context.runId);if(!b||b.user_id!==context.userId||b.role_id!==context.roleId||digest(profile)!==digest(config.profile))throw new AgentStateError('FORBIDDEN');
   adapter(b).model(snapshot);
  },
 },{path:options.path,ownerId:options.ownerId??`pilot-${randomUUID()}`});
 // Durable recovery does not emit live callbacks. Mirror only safely recovered terminal state,
 // without recreating providers, reading credentials, repricing or dispatching HTTP.
 for(const b of db.query('SELECT * FROM pilot_run_bindings').all() as Binding[]){
  const budget=durable.modelAccounting().find(s=>s.scope.runId===createHash('sha256').update(b.run_id).digest('hex').slice(0,40));
  // Terminal run checkpoints can precede a failed budget callback. Recover the budget
  // according to its own persisted state while leaving cancelled/failed/completed intact.
  const recoverable=new Map((budget?.entries??[]).filter(e=>e.status==='unknown'||e.status==='released').map(e=>[adapter(b).attemptId('llm',e.callId),e.status]));
  if(!recoverable.size)continue;
  for(const e of options.ledger.snapshot(b.session_id).entries){const recovered=recoverable.get(e.attemptId);if(!recovered)continue;
   if(e.status==='dispatched')options.ledger.markUnknown(b.session_id,e.attemptId);
   else if(e.status==='reserved'&&recovered==='released')options.ledger.release(b.session_id,e.attemptId);
  }
 }
 }catch(error){db.close();throw error;}
 let closed=false;
 function start(raw:unknown){if(closed)throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
  const parsed=AgentRunRequestSchema.safeParse(raw);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  const request=parsed.data;if(new TextEncoder().encode(JSON.stringify(request)).length>2*1024*1024)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const scope=validateScope(request),value:Binding={run_id:request.context.runId,session_id:scope.sessionId,user_id:request.context.userId,role_id:request.context.roleId,request_digest:digest(request)};
  db.transaction(()=>{const old=binding(value.run_id);if(old){if(old.request_digest!==value.request_digest||old.session_id!==value.session_id||old.user_id!==value.user_id||old.role_id!==value.role_id)throw new AgentStateError('VERSION_CONFLICT');return;}
   db.query('INSERT INTO pilot_run_bindings VALUES(?,?,?,?,?)').run(value.run_id,value.session_id,value.user_id,value.role_id,value.request_digest);
  }).immediate();
  return durable.start(request);
 }
 function close(){if(closed)return;durable.close();db.close();closed=true;}
 return {...durable,start,close,sessionBinding:(runId:string)=>{const b=binding(runId);return b?{sessionId:b.session_id,userId:b.user_id,roleId:b.role_id,requestDigest:b.request_digest}:null;}};
}
