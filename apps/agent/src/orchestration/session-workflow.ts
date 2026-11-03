import{z}from'zod';
import{CreateWorkflowSchema,WorkflowSchema,PlanQuestionCommandSchema,SubmitWorkflowAnswerSchema,FinishWorkflowSchema,
 CloseoutSchema,type InterviewWorkflow}from'../../../../packages/contracts/src/session-workflow.ts';
import type{PlannerInput,PlannerResult}from'../../../../packages/contracts/src/knowledge-planner.ts';
import{PlannerResultSchema}from'../../../../packages/contracts/src/knowledge-planner.ts';
import{AgentStateError,decideNextAction}from'../planning/interview-state.ts';
import{createMemory,startSessionFromMemory,appendMemory}from'../memory/session-memory.ts';
import{evaluateTurn,type EvaluationDependencies}from'./evaluate-turn.ts';
import{selectNextQuestion}from'../planning/select-question.ts';
import{buildInterviewReport}from'../reporting/build-report.ts';
import{reflectSession}from'../reflection/reflect-session.ts';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function retrieved(p:PlannerResult){
 const items=new Map<string,NonNullable<PlannerResult['receipts'][number]['data']>['items'][number]>();
 for(const r of p.receipts){if(r.status==='error')throw new AgentStateError('MODEL_OUTPUT_INVALID');
  for(const i of r.data!.items){if(items.has(i.id)&&!same(items.get(i.id),i))throw new AgentStateError('MODEL_OUTPUT_INVALID');items.set(i.id,i);}}
 return [...items.values()];
}
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const p=schema.safeParse(raw);if(!p.success)throw new AgentStateError('VALIDATION_ERROR');return p.data;}
function snapshot(raw:unknown){
 let text:string;try{text=JSON.stringify(raw);}catch{throw new AgentStateError('VALIDATION_ERROR');}
 if(typeof text!=='string')throw new AgentStateError('VALIDATION_ERROR');
 if(text.length>8*1024*1024)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');const s=parse(WorkflowSchema,raw);
 if(s.current){
  const verified=selectNextQuestion({state:s.state,now:s.currentIssuedAt!,knowledge:retrieved(s.lastPlan!),
   askedQuestionIds:s.askedQuestionIds.filter(id=>id!==s.current!.question.id),planningPolicy:s.policy},{allowDraftKnowledge:s.allowDraftKnowledge});
  if(!same(verified,s.current))throw new AgentStateError('VALIDATION_ERROR');
 }
 return s;
}
function authorize(s:InterviewWorkflow,c:z.infer<typeof FinishWorkflowSchema>|z.infer<typeof PlanQuestionCommandSchema>|z.infer<typeof SubmitWorkflowAnswerSchema>){
 if(c.identity.userId!==s.identity.userId)throw new AgentStateError('FORBIDDEN');
 if(c.identity.roleId!==s.identity.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(c.expectedRevision!==s.revision)throw new AgentStateError('VERSION_CONFLICT');
 if('context'in c){if(c.context.userId!==s.identity.userId)throw new AgentStateError('FORBIDDEN');
  if(c.context.roleId!==s.identity.roleId)throw new AgentStateError('ROLE_FORBIDDEN');}
}
interface Timing{signal?:AbortSignal;now?:()=>number;timeoutMs?:number;}
async function bounded<T>(fn:(signal:AbortSignal,check:()=>number)=>Promise<T>,deps:Timing,deadlineAt=Infinity):Promise<T>{
 const now=deps.now??Date.now,start=now(),timeout=deps.timeoutMs??10000;
 if(!Number.isInteger(timeout)||timeout<1||timeout>30000||!Number.isSafeInteger(start)||start<0)throw new AgentStateError('VALIDATION_ERROR');
 const end=Math.min(deadlineAt,start+timeout),controller=new AbortController();let last=start;
 const check=()=>{if(deps.signal?.aborted)throw new AgentStateError('RUN_CANCELLED');
  const at=now();if(!Number.isSafeInteger(at)||at<last)throw new AgentStateError('VALIDATION_ERROR');last=at;
  if(controller.signal.aborted||at>=end)throw new AgentStateError('DEADLINE_EXCEEDED');return at;};check();
 let timer:ReturnType<typeof setTimeout>|undefined,onAbort:(()=>void)|undefined;
 try{const stop=new Promise<never>((_r,reject)=>{onAbort=()=>{controller.abort();reject(new AgentStateError('RUN_CANCELLED'));};
  deps.signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(new AgentStateError('DEADLINE_EXCEEDED'));},Math.max(1,end-now()));});
  const result=await Promise.race([Promise.resolve().then(()=>{check();return fn(controller.signal,check);}),stop]);check();return result;
 }catch(error){if(error instanceof AgentStateError)throw error;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
 finally{if(timer!==undefined)clearTimeout(timer);if(onAbort)deps.signal?.removeEventListener('abort',onAbort);}
}
export function createInterviewWorkflow(raw:unknown):InterviewWorkflow{
 const c=parse(CreateWorkflowSchema,raw);
 if(c.identity.roleId!==c.session.roleId||c.policy.roleId!==c.session.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(Object.keys(c.skillLabels).length!==c.session.skills.length||c.session.skills.some(s=>!Object.hasOwn(c.skillLabels,s.skillId)))throw new AgentStateError('VALIDATION_ERROR');
 const memory=c.memory??createMemory(c.identity,c.now);
 const state=startSessionFromMemory(memory,{...c.identity,now:c.now,session:c.session});
 return snapshot({kind:'uncommitted-interview-session',revision:0,identity:c.identity,state,policy:c.policy,goal:c.goal,skillLabels:c.skillLabels,
  baseMemory:memory,allowDraftKnowledge:c.allowDraftKnowledge,phase:'ready_to_plan',turns:[],askedQuestionIds:[],issuedQuestions:[],current:null,currentIssuedAt:null,lastPlan:null,pendingReason:null,closeout:null});
}
export async function planInterviewQuestion(raw:unknown,command:unknown,deps:Timing&{plan:(input:PlannerInput,signal:AbortSignal)=>Promise<PlannerResult>}):Promise<InterviewWorkflow>{
 const s=snapshot(raw),c=parse(PlanQuestionCommandSchema,command);authorize(s,c);
 if(s.phase!=='ready_to_plan')throw new AgentStateError('VERSION_CONFLICT');
 return bounded(async(signal,check)=>{
  const at=check(),plan=decideNextAction(s.state,at,s.policy.parameters);
  const result=plan.action==='finish'?{kind:'uncommitted-knowledge-plan',selection:{status:'finished',plan},receipts:[],modelMessages:0}
   :await deps.plan({state:s.state,context:c.context,goal:s.goal,askedQuestionIds:s.askedQuestionIds,planningPolicy:s.policy,allowDraftKnowledge:s.allowDraftKnowledge},signal);
  const p=parse(PlannerResultSchema,result),done=check();
  const verified=selectNextQuestion({state:s.state,now:done,knowledge:retrieved(p),
   askedQuestionIds:s.askedQuestionIds,planningPolicy:s.policy},{allowDraftKnowledge:s.allowDraftKnowledge});
  if(p.selection.status!==verified.status||(p.selection.status==='selected'&&(verified.status!=='selected'||
   !same(p.selection.question,verified.question)||!same(p.selection.rubric,verified.rubric)||!same(p.selection.source,verified.source))))throw new AgentStateError('MODEL_OUTPUT_INVALID');
  if(p.selection.status!=='finished'&&!p.receipts.length)throw new AgentStateError('MODEL_OUTPUT_INVALID');
  const selected=verified.status==='selected'?verified:null;
  return snapshot({...s,revision:s.revision+1,lastPlan:{...p,selection:verified},current:selected,currentIssuedAt:selected?done:null,
   issuedQuestions:selected?[...s.issuedQuestions,{questionId:selected.question.id,issuedAt:done}]:s.issuedQuestions,
   askedQuestionIds:selected?[...s.askedQuestionIds,selected.question.id]:s.askedQuestionIds,
   phase:selected?'awaiting_answer':'ready_to_close',pendingReason:selected?null:p.selection.status==='finished'?'plan_finished':'knowledge_gap'});
 },deps,c.context.deadlineAt);
}
export async function submitInterviewAnswer(raw:unknown,command:unknown,deps:Timing&{evaluate:EvaluationDependencies['evaluate']}):Promise<InterviewWorkflow>{
 const s=snapshot(raw),c=parse(SubmitWorkflowAnswerSchema,command);authorize(s,c);
 if(s.phase!=='awaiting_answer'||!s.current)throw new AgentStateError('VERSION_CONFLICT');
 return bounded(async(signal,check)=>{
  if(check()<s.currentIssuedAt!)throw new AgentStateError('VALIDATION_ERROR');
  const input={state:s.state,expectedVersion:s.state.version,observationId:c.observationId,goal:s.goal,context:c.context,
   question:s.current!.question,answer:c.answer,quality:c.quality,rubric:s.current!.rubric,knowledge:[],planningPolicy:s.policy,...(c.speech?{speech:c.speech}:{})};
  if(s.turns.some(t=>t.input.answer.id===c.answer.id||t.input.context.runId===c.context.runId))throw new AgentStateError('VERSION_CONFLICT');
  const proposal=await evaluateTurn(input,{evaluate:deps.evaluate,signal,now:deps.now??Date.now});check();
  const finished=proposal.nextAction.action==='finish';
  return snapshot({...s,revision:s.revision+1,state:proposal.nextState,turns:[...s.turns,{input,proposal,evidenceMode:c.evidenceMode}],
   current:null,currentIssuedAt:null,phase:finished?'ready_to_close':'ready_to_plan',pendingReason:finished?'plan_finished':null});
 },deps,Math.min(c.context.deadlineAt,s.state.deadlineAt));
}
async function closeCandidates(s:InterviewWorkflow,c:z.infer<typeof FinishWorkflowSchema>,at:number,check:()=>number){
 const reason=c.mode==='user_stop'?'user_stop':s.pendingReason;
 if(!reason)throw new AgentStateError('VERSION_CONFLICT');
 const reportInput={state:s.state,generatedAt:at,policyVersion:s.policy.id,skillLabels:s.skillLabels,turns:s.turns};
 const report=await buildInterviewReport(reportInput);check();
 const memoryCandidate=s.turns.length?await appendMemory(s.baseMemory,{...s.identity,expectedVersion:s.baseMemory.version,sessionStatus:'completed',now:at,reportInput}):s.baseMemory;check();
 const reflection=await reflectSession({reportInput,baselinePolicy:s.policy,generatedAt:at,sourceGroupId:c.sourceGroupId});check();
 return parse(CloseoutSchema,{kind:'uncommitted-interview-closeout',sessionId:s.state.sessionId,sessionVersion:s.state.version,generatedAt:at,
  sourceGroupId:c.sourceGroupId,requestRevision:s.closeout?.requestRevision??c.expectedRevision,requestMode:c.mode,reason,report,memoryCandidate,memoryDisposition:s.turns.length?'appended':'unchanged_no_answers',reflection});
}
export async function finishInterviewWorkflow(raw:unknown,command:unknown,deps:Timing={}):Promise<InterviewWorkflow>{
 const s=snapshot(raw),c=parse(FinishWorkflowSchema,command);
 authorize(s,s.phase==='completed'&&c.expectedRevision===s.closeout!.requestRevision?{...c,expectedRevision:s.revision}:c);
 if(s.phase==='completed'){
  if(s.closeout!.sourceGroupId!==c.sourceGroupId||s.closeout!.requestMode!==c.mode)throw new AgentStateError('VERSION_CONFLICT');
  return bounded(async(_signal,check)=>{const expected=await closeCandidates(s,c,s.closeout!.generatedAt,check);
   if(!same(expected,s.closeout))throw new AgentStateError('VALIDATION_ERROR');return s;},deps);
 }
 if(c.mode==='automatic'&&s.phase!=='ready_to_close')throw new AgentStateError('VERSION_CONFLICT');
 return bounded(async(_signal,check)=>{const closeout=await closeCandidates(s,c,check(),check);
  return snapshot({...s,revision:s.revision+1,phase:'completed',current:null,currentIssuedAt:null,pendingReason:closeout.reason,closeout});},deps);
}
export async function restoreInterviewWorkflow(json:string,identity:unknown):Promise<InterviewWorkflow>{
 if(typeof json!=='string'||json.length>8*1024*1024)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
 let raw:unknown;try{raw=JSON.parse(json);}catch{throw new AgentStateError('VALIDATION_ERROR');}
 const s=snapshot(raw);authorize(s,parse(FinishWorkflowSchema,{identity,expectedRevision:s.revision,sourceGroupId:'restore',mode:'automatic'}));
 if(s.turns.length)await buildInterviewReport({state:s.state,generatedAt:s.closeout?.generatedAt??Math.max(s.state.startedAt,s.state.observations.at(-1)!.observedAt),
  policyVersion:s.policy.id,skillLabels:s.skillLabels,turns:s.turns});
 if(s.phase==='completed')return finishInterviewWorkflow(s,{identity:s.identity,expectedRevision:s.revision,mode:s.closeout!.requestMode,sourceGroupId:s.closeout!.sourceGroupId});
 return s;
}
