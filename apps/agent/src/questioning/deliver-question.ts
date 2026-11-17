import{QuestionDeliveryInputSchema,QuestionDeliverySchema,BridgeGenerationRequestSchema,BridgeModelOutputSchema,
 type QuestionDelivery,type BridgeGenerator}from'../../../../packages/contracts/src/question-delivery.ts';
import{AgentStateError,estimateSkills}from'../planning/interview-state.ts';
import{isGroundedNeutralTransition}from'../../../../packages/interview-domain/src/question-transition.ts';
export interface DeliveryDependencies{generate?:BridgeGenerator;now?:()=>number;signal?:AbortSignal;timeoutMs?:number;}
/** Presentation only: never rewrites the selected question or changes its scoring rubric. */
export async function deliverQuestion(raw:unknown,deps:DeliveryDependencies={}):Promise<QuestionDelivery|undefined>{
 const parsed=QuestionDeliveryInputSchema.safeParse(raw);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
 const i=parsed.data,now=deps.now??Date.now,started=now(),timeout=deps.timeoutMs??8000;
 if(!Number.isSafeInteger(started)||started<0||!Number.isInteger(timeout)||timeout<1||timeout>20000)throw new AgentStateError('VALIDATION_ERROR');
 const deadline=Math.min(i.context.deadlineAt,i.state.deadlineAt);
 let modelDeadline=Infinity,last=started;
 const check=()=>{if(deps.signal?.aborted)throw new AgentStateError('RUN_CANCELLED');const t=now();
  if(!Number.isSafeInteger(t)||t<last)throw new AgentStateError('VALIDATION_ERROR');last=t;if(t>=deadline||t>=modelDeadline)throw new AgentStateError('DEADLINE_EXCEEDED');return t;};
 check();if(i.selection.status!=='selected')return;
 const s=i.selection;
 const finish=(reason:QuestionDelivery['reason'],bridge:string|null=null,excerpt:string|null=null)=>{
  check();return QuestionDeliverySchema.parse({kind:'uncommitted-question-delivery',question:s.question,
   basedOn:{runId:i.context.runId,attemptId:i.context.attemptId,sessionId:i.state.sessionId,stateVersion:i.state.version,
    previousAnswerId:i.previousAnswer.id,rubricId:s.rubric.id,rubricVersion:s.rubric.version,sourceVersion:s.source.version},
   status:reason==='generated'?'generated':'canonical',reason,bridge,excerpt,text:bridge?bridge+'\n'+s.question.text:s.question.text,
   semanticReview:bridge?'pending':'not-applicable'});
 };
 if(!deps.generate)return finish('disabled');
 if(deadline-check()<timeout+2000||i.state.deadlineAt-check()<timeout+i.wrapUpSeconds*1000||s.plan.remainingSeconds<45)return finish('time-budget');
 const skill=estimateSkills(i.state,check()).find(k=>k.skillId===s.question.skillId)!;
 const request=BridgeGenerationRequestSchema.parse({promptVersion:'question-delivery-v1',previousAnswerText:i.previousAnswer.text,
  nextQuestion:{text:s.question.text,skillId:s.question.skillId,difficulty:s.question.difficulty,questionType:s.question.questionType},
  state:{action:s.plan.action,remainingSeconds:s.plan.remainingSeconds,mastery:skill.mastery,confidence:skill.confidence}});
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,onAbort:(()=>void)|undefined;
 modelDeadline=check()+timeout;
 try{
  const stop=new Promise<never>((_resolve,reject)=>{onAbort=()=>{controller.abort();reject(new AgentStateError('RUN_CANCELLED'));};
   deps.signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(new AgentStateError('DEADLINE_EXCEEDED'));},Math.min(timeout,deadline-check()));});
  const output=await Promise.race([Promise.resolve().then(()=>{check();return deps.generate!(structuredClone(request),controller.signal);}),stop]);check();
  const p=BridgeModelOutputSchema.safeParse(output);if(!p.success)return finish('invalid-output');
  const {bridge,excerpt}=p.data;
  if(!isGroundedNeutralTransition(i.previousAnswer.text,bridge,excerpt))return finish('invalid-output');
  return finish('generated',bridge,excerpt);
 }catch(e){check();if(e instanceof AgentStateError&&e.code==='MODEL_OUTPUT_INVALID')return finish('invalid-output');
  if(e instanceof AgentStateError&&e.code==='TOOL_BUDGET_EXCEEDED')return finish('call-budget');
  if(e instanceof AgentStateError)throw e;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
 }finally{if(timer)clearTimeout(timer);if(onAbort)deps.signal?.removeEventListener('abort',onAbort);}
}
