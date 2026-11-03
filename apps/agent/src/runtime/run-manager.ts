import{createHash}from'node:crypto';
import{z}from'zod';
import{AgentRunRequestSchema,AgentRunResultSchema,AgentRunEventSchema,AgentRunSnapshotSchema,
 type AgentRunRequest,type AgentRunResult,type AgentRunEvent,type AgentRunSnapshot}from'../../../../packages/contracts/src/agent-run.ts';
import{AgentRunStageSchema}from'../../../../packages/contracts/src/agent-run.ts';
import{describeError}from'../../../../packages/contracts/src/errors.ts';
import type{RoleId,ErrorCode}from'../../../../packages/contracts/src/tools.ts';
import{AgentStateError}from'../planning/interview-state.ts';
import{evaluateTurn,type EvaluationDependencies}from'../orchestration/evaluate-turn.ts';
import{selectNextQuestion}from'../planning/select-question.ts';
import{buildInterviewReport}from'../reporting/build-report.ts';
import type { InterviewBackend } from './backend.ts';
import{PlannerResultSchema,type PlannerInput,type PlannerResult}from'../../../../packages/contracts/src/knowledge-planner.ts';
import{executeWorkflowJob}from'./workflow-job.ts';
import{evaluateWorkflowRsi}from'../reflection/evaluate-workflow-rsi.ts';
export interface RunManagerDependencies{evaluateForRole:(roleId:RoleId)=>EvaluationDependencies['evaluate'];now?:()=>number;
 planForRole?:(roleId:RoleId)=>(input:PlannerInput,signal:AbortSignal)=>Promise<PlannerResult>;}
interface Entry{snapshot:AgentRunSnapshot;events:AgentRunEvent[];listeners:Set<()=>void>;controller:AbortController;digest:string;done:Promise<void>;resolve:()=>void;}
const OptionsSchema=z.object({maxRuns:z.number().int().min(1).max(100).default(32),maxActiveRuns:z.number().int().min(1).max(20).default(4),
 timeoutMs:z.number().int().min(1).max(60000).default(30000)}).strict();
const terminal=(s:AgentRunSnapshot['status'])=>['completed','failed','cancelled'].includes(s);
export function createRunManager(dependencies:RunManagerDependencies,rawOptions:unknown={}){
 const config=OptionsSchema.safeParse(rawOptions);if(!config.success||typeof dependencies.evaluateForRole!=='function')throw new AgentStateError('VALIDATION_ERROR');
 const options=config.data,now=dependencies.now??Date.now,entries=new Map<string,Entry>();let disposed=false;
 const clock=()=>{const n=now();if(!Number.isSafeInteger(n)||n<0)throw new AgentStateError('VALIDATION_ERROR');return n;};
 const find=(id:string)=>{const e=entries.get(id);if(!e)throw new AgentStateError('NOT_FOUND');return e;};
 const snapshot=(id:string)=>structuredClone(find(id).snapshot);
 function emit(e:Entry,type:AgentRunEvent['type'],payload:unknown){
  const previous=Date.parse(e.snapshot.updatedAt),read=now();
  const at=Number.isSafeInteger(read)&&read>=previous?read:previous;
  const event=AgentRunEventSchema.parse({schemaVersion:1,runId:e.snapshot.runId,attemptId:e.snapshot.attemptId,seq:e.events.length+1,
   occurredAt:new Date(at).toISOString(),type,payload});
  e.events.push(event);e.snapshot.lastEventSeq=event.seq;e.snapshot.updatedAt=event.occurredAt;
  for(const notify of e.listeners)notify();
 }
 function fail(e:Entry,code:ErrorCode){if(terminal(e.snapshot.status))return;
  const {message,retryable}=describeError(code);e.snapshot={...e.snapshot,status:code==='RUN_CANCELLED'?'cancelled':'failed',stage:null,result:null,error:{code,message,retryable}};
  if(code==='RUN_CANCELLED')emit(e,'run.cancelled',{reason:'host_cancelled'});else emit(e,'run.failed',{error:e.snapshot.error});
 }
 async function process(e:Entry,request:AgentRunRequest){
  let timer:ReturnType<typeof setTimeout>|undefined,onAbort:(()=>void)|undefined;
  try{
   if(terminal(e.snapshot.status))return;e.snapshot.status='running';
   const check=()=>{if(e.controller.signal.aborted)throw(e.controller.signal.reason??new AgentStateError('RUN_CANCELLED'));
    if(clock()>=request.context.deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');};
   const stage=(value:z.infer<typeof AgentRunStageSchema>,message:string)=>{check();e.snapshot.stage=value;emit(e,'run.stage',{stage:value,message});};
   const stop=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(e.controller.signal.reason??new AgentStateError('RUN_CANCELLED'));
    e.controller.signal.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>e.controller.abort(new AgentStateError('DEADLINE_EXCEEDED')),Math.max(1,Math.min(options.timeoutMs,request.context.deadlineAt-clock())));});
   const work=(async():Promise<AgentRunResult>=>{
    if(request.job.type==='rsi'){
     stage('rsi_evaluating','正在隔离评测收尾策略候选');
     const result=await evaluateWorkflowRsi(request.job.input,{signal:e.controller.signal,now,deadlineAt:request.context.deadlineAt});check();return result;
    }
    if(request.job.type==='workflow'){
     const snapshot=await executeWorkflowJob(request.job,request.context,dependencies,e.controller.signal,options.timeoutMs,stage);check();
     return{kind:'uncommitted-workflow-result',action:request.job.operation.action,snapshot};
    }
    if(request.job.type==='turn'){
     stage('evaluating','正在评估回答');
     const proposal=await evaluateTurn(request.job.input,{evaluate:dependencies.evaluateForRole(request.context.roleId),now,
      signal:e.controller.signal,timeoutMs:options.timeoutMs});check();stage('selecting','正在选择下一题');
     const planning=dependencies.planForRole?PlannerResultSchema.parse(await dependencies.planForRole(request.context.roleId)({state:proposal.nextState,
      context:request.context,goal:request.job.input.goal,askedQuestionIds:request.job.askedQuestionIds,
      ...(request.job.input.planningPolicy?{planningPolicy:request.job.input.planningPolicy}:{}),allowDraftKnowledge:request.job.allowDraftKnowledge},e.controller.signal)):undefined;
     check();const selection=planning?.selection??selectNextQuestion({state:proposal.nextState,now:clock(),knowledge:request.job.knowledge,
      askedQuestionIds:request.job.askedQuestionIds,planningPolicy:request.job.input.planningPolicy},{allowDraftKnowledge:request.job.allowDraftKnowledge});
     check();if(selection.status==='selected')emit(e,'question.completed',{question:selection.question});
     return{kind:'uncommitted-turn-result',proposal,selection,...(planning?{planning}:{})};
    }
    stage('reporting','正在整理内容报告');const report=await buildInterviewReport(request.job.input);check();return{kind:'uncommitted-report-result',report};
   })();
   const result=AgentRunResultSchema.parse(await Promise.race([work,stop]));check();
   if(terminal(e.snapshot.status))return;e.snapshot={...e.snapshot,status:'completed',stage:null,result,error:null};
   if(result.kind==='uncommitted-workflow-result'){
    const s=result.snapshot;emit(e,'workflow.updated',{action:result.action,sessionId:s.state.sessionId,revision:s.revision,phase:s.phase,stateVersion:s.state.version});
    if(result.action==='plan'&&s.current)emit(e,'question.completed',{question:s.current.question});
   }
   if(result.kind==='uncommitted-workflow-rsi')emit(e,'rsi.completed',{sessionId:result.source.sessionId,experimentId:result.registryCandidate.experimentId,
    status:result.status,registryVersion:result.registryCandidate.version,evidenceMode:'synthetic',productionPublished:false,
    baselineAgreement:result.evaluation?.baseline.value??null,candidateAgreement:result.evaluation?.candidate.value??null,delta:result.evaluation?.delta??null});
   emit(e,'run.completed',{resultKind:result.kind,committed:false});
  }catch(error){fail(e,error instanceof AgentStateError?error.code:'INTERNAL_ERROR');}
  finally{if(timer!==undefined)clearTimeout(timer);if(onAbort)e.controller.signal.removeEventListener('abort',onAbort);e.resolve();}
 }
 function start(rawRequest:unknown):AgentRunSnapshot{
  if(disposed)throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
  const parsed=AgentRunRequestSchema.safeParse(rawRequest);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  const request=parsed.data,text=JSON.stringify(request);
  if(new TextEncoder().encode(text).length>2*1024*1024)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const digest=createHash('sha256').update(text).digest('hex'),existing=entries.get(request.context.runId);
  if(existing){if(existing.digest!==digest)throw new AgentStateError('VERSION_CONFLICT');return snapshot(request.context.runId);}
  const at=clock();if(at>=request.context.deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');
  if(entries.size>=options.maxRuns||[...entries.values()].filter(e=>!terminal(e.snapshot.status)).length>=options.maxActiveRuns)throw new AgentStateError('RATE_LIMITED');
  let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});
  const e:Entry={digest,done,resolve,events:[],listeners:new Set(),controller:new AbortController(),snapshot:AgentRunSnapshotSchema.parse({
   runId:request.context.runId,attemptId:request.context.attemptId,inputSnapshotId:request.inputSnapshotId,status:'queued',stage:'queued',
   createdAt:new Date(at).toISOString(),updatedAt:new Date(at).toISOString(),lastEventSeq:0,error:null,result:null})};
  entries.set(request.context.runId,e);emit(e,'run.accepted',{stage:'queued'});queueMicrotask(()=>{void process(e,request);});return snapshot(request.context.runId);
 }
 function cancel(runId:string,attemptId:string):AgentRunSnapshot{
  const e=find(runId);if(e.snapshot.attemptId!==attemptId)throw new AgentStateError('VERSION_CONFLICT');
  if(!terminal(e.snapshot.status)){fail(e,'RUN_CANCELLED');e.controller.abort(new AgentStateError('RUN_CANCELLED'));}return snapshot(runId);
 }
 async function* events(runId:string,afterSeq=0,signal?:AbortSignal):AsyncGenerator<AgentRunEvent>{
  const e=find(runId);if(!Number.isSafeInteger(afterSeq)||afterSeq<0)throw new AgentStateError('VALIDATION_ERROR');
  if(afterSeq>e.snapshot.lastEventSeq)throw new AgentStateError('VERSION_CONFLICT');
  const pending=e.events.filter(event=>event.seq>afterSeq);let wake:(()=>void)|undefined;
  const listener=()=>{const last=pending.at(-1)?.seq??afterSeq;pending.push(...e.events.filter(event=>event.seq>last));wake?.();wake=undefined;};
  const aborted=()=>{wake?.();wake=undefined;};e.listeners.add(listener);signal?.addEventListener('abort',aborted,{once:true});
  try{while(!signal?.aborted){while(pending.length&&!signal?.aborted){const event=pending.shift()!;afterSeq=event.seq;yield structuredClone(event);}
    if(terminal(e.snapshot.status)||signal?.aborted)break;await new Promise<void>(resolve=>{wake=resolve;});}}
  finally{e.listeners.delete(listener);signal?.removeEventListener('abort',aborted);}
 }
 function dispose(){if(disposed)return;disposed=true;for(const e of entries.values())if(!terminal(e.snapshot.status))cancel(e.snapshot.runId,e.snapshot.attemptId);}
 return{start,snapshot,cancel,events,wait:(runId:string)=>find(runId).done,dispose} satisfies InterviewBackend & {wait:(runId:string)=>Promise<void>;dispose:()=>void};
}
export type AgentRunManager=ReturnType<typeof createRunManager>;
