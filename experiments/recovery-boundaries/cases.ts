import {mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
import {describeError} from '../../packages/contracts/src/errors.ts';
import {AgentRunEventSchema,AgentRunSnapshotSchema} from '../../packages/contracts/src/agent-run.ts';
import {createRunManager} from '../../apps/agent/src/runtime/run-manager.ts';
import {openDurableStore} from '../../apps/agent/src/runtime/durable-store.ts';
import {createModelBudgetGate} from '../../apps/agent/src/model-access/budget.ts';
import config from '../../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import {initialClarificationRequest} from '../durable-clarification/fixture.ts';
import {contentHash} from '../../evals/answers/validation.ts';
import {evaluateTurnWithClarification} from '../../apps/agent/src/orchestration/clarify-turn.ts';
export const recoveryDecisions=[
 {id:'cancel-late',trigger:'宿主取消后依赖仍未结束',result:'保持cancelled，丢弃迟到结果',accounting:'未结消耗不补零；等待真实依赖释放槽位',retry:'不自动新run'},
 {id:'deadline-late',trigger:'总期限后依赖仍未结束',result:'保持failed，丢弃迟到结果',accounting:'未结消耗保留，槽位等真实依赖结束',retry:'不因retryable自动重派'},
 {id:'terminal-cancel',trigger:'已取消、租约仍有效',result:'拒绝终态后checkpoint复活',accounting:'当前owner仍可结清已派发usage',retry:'结果和消耗分别处理'},
 {id:'terminal-timeout',trigger:'已超时、租约仍有效',result:'拒绝终态后checkpoint复活',accounting:'当前owner仍可结清已派发usage',retry:'不恢复旧结果'},
 {id:'terminal-completed',trigger:'已完成候选、租约仍有效',result:'冻结结果与事件',accounting:'账务校验仍单独执行',retry:'同run只重放，不追加状态'},
 {id:'lease-reserved',trigger:'租约到期、仅预留未派发',result:'interrupted，旧owner双通道拒写',accounting:'释放reserved，禁止旧owner续写',retry:'新run需宿主决策'},
 {id:'lease-dispatched',trigger:'租约到期、已派发未结',result:'interrupted，旧owner双通道拒写',accounting:'dispatched转unknown，保留预留并阻断',retry:'显式对账后才可新run'},
] as const;
export type BoundaryScenario=typeof recoveryDecisions[number]['id'];
const denied=(fn:()=>unknown,code:string)=>{try{fn();return false;}catch(e){return e instanceof Error&&e.message===code;}};
export async function runRecoveryBoundaryCase(role:RoleId,scenario:BoundaryScenario){
 const decision=recoveryDecisions.find(c=>c.id===scenario)!;if(!decision)throw Error('RECOVERY_BOUNDARY_INVALID');
 const fixture=initialClarificationRequest(role),req=fixture.request,checks:{id:string;passed:boolean}[]=[];
 const check=(id:string,passed:boolean)=>checks.push({id,passed});
 if(scenario==='cancel-late'||scenario==='deadline-late'){
  let entered!:()=>void,release!:(v:unknown)=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<unknown>(resolve=>{release=resolve;});
  const runtime=createRunManager({evaluateForRole:()=>async()=>{entered();return gate;}},{maxActiveRuns:1,timeoutMs:scenario==='deadline-late'?20:30000});
  try{
   runtime.start(req);await started;if(scenario==='cancel-late')runtime.cancel(req.context.runId,req.context.attemptId);
   await runtime.wait(req.context.runId);const terminal=runtime.snapshot(req.context.runId),before=contentHash(terminal);
   check('terminal',terminal.status===(scenario==='cancel-late'?'cancelled':'failed')&&terminal.error?.code===(scenario==='cancel-late'?'RUN_CANCELLED':'DEADLINE_EXCEEDED'));
   check('dependency-retained',runtime.diagnostics().inFlightDependencies===1&&runtime.diagnostics().occupiedSlots===1);
   const context={...req.context,runId:req.context.runId+'-next'};
   if(req.job.type!=='turn')throw Error();
   const job=req.job;
   check('slot-not-reused',denied(()=>runtime.start({...req,inputSnapshotId:context.runId,context,job:{...job,input:{...job.input,context}}}),'RATE_LIMITED'));
   release(fixture.output);await new Promise(resolve=>setTimeout(resolve,0));
   check('late-result-ignored',contentHash(runtime.snapshot(req.context.runId))===before&&runtime.snapshot(req.context.runId).result===null);
   check('slot-released',runtime.diagnostics().inFlightDependencies===0&&runtime.diagnostics().occupiedSlots===0);
   const events=[];for await(const e of runtime.events(req.context.runId))events.push(e);
   check('no-success-event',!events.some(e=>e.type==='run.completed'));
  }finally{release(fixture.output);runtime.dispose();}
 }else{
  const root=join(process.cwd(),'.cache','recovery-boundaries');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-')),path=join(dir,'agent.sqlite');
  if(req.job.type!=='turn')throw Error();let now=req.job.input.state.startedAt;
  const a=openDurableStore(path,{ownerId:'old',now:()=>now,leaseMs:1000});let b:ReturnType<typeof openDurableStore>|undefined;
  try{
   a.enqueue(req);const fence=a.claim(req.context.runId),stamp=new Date(now).toISOString();
   const accepted=AgentRunSnapshotSchema.parse({runId:req.context.runId,attemptId:req.context.attemptId,inputSnapshotId:req.inputSnapshotId,status:'queued',stage:'queued',createdAt:stamp,updatedAt:stamp,lastEventSeq:1,error:null,result:null});
   const event=(seq:number,type:string,payload:unknown)=>AgentRunEventSchema.parse({schemaVersion:1,runId:req.context.runId,attemptId:req.context.attemptId,seq,occurredAt:new Date(now).toISOString(),type,payload});
   a.checkpointRun(req.context.runId,fence,accepted,event(1,'run.accepted',{stage:'queued'}));
   const pseudo=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,40);
   const budget=createModelBudgetGate(config.profile,{budgetId:'boundary',userId:pseudo(req.context.userId),roleId:role,runId:pseudo(req.context.runId),attemptId:pseudo(req.context.attemptId),deadlineAt:req.context.deadlineAt},
    {now:()=>now,allowLive:true,onCheckpoint:s=>a.checkpointBudget(req.context.runId,fence,s,config.profile)});
   budget.reserve('call',{inputTokens:100,outputTokens:30});if(scenario!=='lease-reserved')budget.dispatch('call');
   if(scenario.startsWith('terminal-')){
    const cancel=scenario==='terminal-cancel',completed=scenario==='terminal-completed',{status:_http,...failure}=describeError(cancel?'RUN_CANCELLED':'DEADLINE_EXCEEDED');
    let result:unknown=null;
    if(completed){const resolution=await evaluateTurnWithClarification(req.job.input,{now:()=>now,evaluate:async()=>fixture.output});if(resolution.status==='scored')throw Error();result={kind:'uncommitted-unscored-turn-result',resolution};}
    const error=completed?null:failure,terminal=AgentRunSnapshotSchema.parse({...accepted,status:completed?'completed':cancel?'cancelled':'failed',stage:null,error,result,lastEventSeq:2});
    a.checkpointRun(req.context.runId,fence,terminal,event(2,completed?'run.completed':cancel?'run.cancelled':'run.failed',completed?{resultKind:'uncommitted-unscored-turn-result',committed:false}:cancel?{reason:'host_cancelled'}:{error}));
    const before=contentHash(a.task(req.context.runId));
    const late=AgentRunSnapshotSchema.parse({...terminal,status:'running',stage:'evaluating',error:null,result:null,lastEventSeq:3});
    check('terminal-checkpoint-rejected',denied(()=>a.checkpointRun(req.context.runId,fence,late,event(3,'run.stage',{stage:'evaluating',message:'late callback'})),'DURABLE_TERMINAL'));
    check('terminal-and-events-frozen',contentHash(a.task(req.context.runId))===before&&a.events(req.context.runId).length===2);
    budget.settle('call',{inputTokens:10,outputTokens:2,complete:true});
    check('owned-late-usage-settled',a.accounting()[0]!.snapshot.totals.usedTokens===12&&a.accounting()[0]!.snapshot.entries[0]!.status==='settled');
   }else{
    now+=1000;b=openDurableStore(path,{ownerId:'new',now:()=>now,leaseMs:1000});b.recoverExpired();
    const before=contentHash({task:b.task(req.context.runId),accounting:b.accounting(),events:b.events(req.context.runId)}),s=b.accounting()[0]!.snapshot;
    check('exact-expiry-fenced',b.task(req.context.runId)!.status==='interrupted'&&!a.isOwner(req.context.runId,fence));
    const late={...accepted,status:'running',stage:'evaluating',lastEventSeq:3,updatedAt:new Date(now).toISOString()};
    check('stale-result-rejected',denied(()=>a.checkpointRun(req.context.runId,fence,late,event(3,'run.stage',{stage:'evaluating',message:'old owner'})),'DURABLE_FENCED'));
    check('stale-budget-rejected',denied(()=>a.checkpointBudget(req.context.runId,fence,budget.snapshot(),config.profile),'DURABLE_FENCED'));
    check('rejected-writes-atomic',contentHash({task:b.task(req.context.runId),accounting:b.accounting(),events:b.events(req.context.runId)})===before);
    check('usage-state',s.entries[0]!.status===(scenario==='lease-reserved'?'released':'unknown'));
    check('hold-and-block',scenario==='lease-reserved'?s.totals.heldTokens===0&&!b.hasBlockedAccounting():s.totals.heldTokens===130&&b.hasBlockedAccounting());
   }
  }finally{a.close();b?.close();}
 }
 return {role,scenario,decision,checks,liveModelCalls:0 as const,formalCommitted:false as const};
}
