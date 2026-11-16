import{LiveServiceConfigSchema}from'../../../../packages/contracts/src/live-model.ts';
import{AgentRunRequestSchema,type AgentRunSnapshot,type AgentRunEvent}from'../../../../packages/contracts/src/agent-run.ts';
import{openDurableStore}from'./durable-store.ts';
import{createLiveRunManager}from'./live-runtime.ts';
import{assertLiveAuthorized,type LiveModelDependencies}from'../model-access/bailian-provider.ts';
import{AgentStateError}from'../planning/interview-state.ts';
import{createRuntimeShutdown}from'./shutdown.ts';
import{workflowCommitDigest as digest}from'../../../../packages/agent-client/src/workflow-commit.ts';
/** Durable Agent operation records, not the API's formal workflow/database transaction. */
export function createDurableLiveRunManager(raw:unknown,deps:LiveModelDependencies,options:{path:string;ownerId:string;leaseMs?:number}){
 const c=LiveServiceConfigSchema.parse(raw),now=deps.now??Date.now,store=openDurableStore(options.path,{ownerId:options.ownerId,now,leaseMs:options.leaseMs??c.profile.limits.timeoutMs+1000});
 store.recoverExpired();const owned=new Map<string,number>();let runtime:ReturnType<typeof createLiveRunManager>|undefined,closed=false,draining=false;
 const mapped=(e:unknown):never=>{if(e instanceof AgentStateError)throw e;const message=e instanceof Error?e.message:'';
  throw new AgentStateError(message==='DURABLE_REQUEST_CONFLICT'?'VERSION_CONFLICT':message==='DURABLE_NOT_FOUND'?'NOT_FOUND':message==='DURABLE_RUN_LIMIT'?'RATE_LIMITED':'DEPENDENCY_UNAVAILABLE');};
 const guard=<T>(fn:()=>T):T=>{try{if(closed)throw Error('closed');return fn();}catch(e){return mapped(e);}};
 function backend(){return runtime??=createLiveRunManager(c,{...deps,
  hasBlockedAccounting:()=>store.hasBlockedAccounting(),
  canDispatch:()=>!store.hasBlockedAccounting()&&(deps.canDispatch?.()??true),
  canDispatchRun:context=>store.isOwner(context.runId,owned.get(context.runId)??-1)&&(deps.canDispatchRun?.(context)??true),
  onRunCheckpoint:(snapshot,event)=>{deps.onRunCheckpoint?.(snapshot,event);store.checkpointRun(snapshot.runId,owned.get(snapshot.runId)??-1,snapshot,event);},
  onBudgetCheckpoint:(context,snapshot,profile)=>{deps.onBudgetCheckpoint?.(context,snapshot,profile);store.checkpointBudget(context.runId,owned.get(context.runId)??-1,snapshot,profile);}
 });}
 function start(rawRequest:unknown):AgentRunSnapshot{return guard(()=>{
  if(draining)throw new AgentStateError('DEPENDENCY_UNAVAILABLE');const parsed=AgentRunRequestSchema.safeParse(rawRequest);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  if(new TextEncoder().encode(JSON.stringify(parsed.data)).length>2*1024*1024)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  store.recoverExpired();const request=parsed.data,existing=store.task(request.context.runId);
  if(existing){store.enqueue(request);if(existing.status!=='queued'){
   if(existing.status==='running'&&!owned.has(request.context.runId))throw new AgentStateError('VERSION_CONFLICT');
   if(!existing.snapshot)throw new AgentStateError('DEPENDENCY_UNAVAILABLE');return existing.snapshot;
  }}
  assertLiveAuthorized(c,now());if(store.hasBlockedAccounting())throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
  store.enqueue(request);const fence=store.claim(request.context.runId,{key:digest({profile:c.profile,authorization:c.authorization}),maxRuns:c.authorization.maxRuns});owned.set(request.context.runId,fence);
  try{return backend().start(request);}catch(e){store.abandon(request.context.runId,fence);throw e;}
 });}
 const snapshot=(id:string):AgentRunSnapshot=>guard(()=>{store.recoverExpired();const task=store.task(id);if(!task?.snapshot)throw new AgentStateError('NOT_FOUND');return task.snapshot;});
 const cancel=(id:string,attemptId:string)=>guard(()=>{
  const task=store.task(id);if(!task?.snapshot)throw new AgentStateError('NOT_FOUND');if(task.request.context.attemptId!==attemptId)throw new AgentStateError('VERSION_CONFLICT');
  if(task.status!=='running')return task.snapshot;if(!runtime||!owned.has(id))throw new AgentStateError('VERSION_CONFLICT');return runtime.cancel(id,attemptId);
 });
 async function* events(id:string,after=0,signal?:AbortSignal):AsyncGenerator<AgentRunEvent>{
  const s=snapshot(id);if(!Number.isSafeInteger(after)||after<0)throw new AgentStateError('VALIDATION_ERROR');if(after>s.lastEventSeq)throw new AgentStateError('VERSION_CONFLICT');
  if(runtime&&owned.has(id)){for await(const event of runtime.events(id,after,signal))yield event;return;}
  for(const event of store.events(id,after)){if(signal?.aborted)break;yield event;}
 }
 function dispose(){draining=true;runtime?.dispose();}
 const diagnostics=()=>runtime?.diagnostics()??{disposed:closed,draining,retainedRuns:0,activeRuns:0,occupiedSlots:0,inFlightDependencies:0,pendingWork:0,deadlineTimers:0,eventSubscribers:0};
 const shutdown=createRuntimeShutdown({closeAdmission:()=>{draining=true;},cancelActive:()=>{const active=diagnostics().activeRuns;dispose();return active;},resources:()=>{
  const{disposed:_d,draining:_g,...counts}=diagnostics();return counts;
 }});
 function close(){if(closed)return;if(diagnostics().occupiedSlots>0)throw Error('DURABLE_BUSY');dispose();store.close();closed=true;}
 return{start,snapshot,cancel,events,dispose,shutdown,diagnostics,close,storage:'sqlite-wal-full' as const,
  wait:(id:string)=>runtime&&owned.has(id)?runtime.wait(id):Promise.resolve(),
  modelAccounting:()=>store.accounting().map(a=>a.snapshot),durableTasks:(id:string)=>store.task(id),reconcile:store.reconcile,
  evaluationDiagnostics:()=>runtime?.evaluationDiagnostics()??[],recoveryDiagnostics:()=>runtime?.recoveryDiagnostics()??[]};
}
