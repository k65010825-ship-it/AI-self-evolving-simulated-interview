import{z}from'zod';
import{Type}from'typebox';
import type{Api,Model,AssistantMessage}from'@earendil-works/pi-ai';
import{type ModelRuntime,type AgentSession,type ToolDefinition}from'@earendil-works/pi-coding-agent';
import{PlannerInputSchema,PlannerQuerySchema,PlannerChoiceSchema,PlannerResultSchema,type PlannerResult}from'../../../../../packages/contracts/src/knowledge-planner.ts';
import type{ErrorCode,ToolReceipt,KnowledgeItem}from'../../../../../packages/contracts/src/tools.ts';
import{AgentStateError,resolveQuestionPlan,estimateSkills}from'../../planning/interview-state.ts';
import {eligibleQuestions} from '../../../../../packages/interview-domain/src/question-eligibility.ts';
import {fallbackGuidance} from '../../harness/skills/planning.ts';
import{selectNextQuestion}from'../../planning/select-question.ts';
import{createKnowledgeExecutor}from'../../tools/knowledge-executor.ts';
import{createCuratedKnowledgeExecutor}from'../../knowledge/catalog.ts';
import{createHarnessPiSession}from'./session-factory.ts';
import{recallStateEvidence,projectMemoryForPrompt}from'../../memory/recall.ts';
import{fitMemoryContext}from'../../context/memory-view.ts';
import{describeHistoryCompatibility}from'../../memory/history-compatibility.ts';

const Options=z.object({cwd:z.string().min(1),knowledgeMode:z.enum(['seed','reviewed-only','draft-preview']).default('seed'),timeoutMs:z.number().int().min(1).max(30000).default(10000),
 maxToolCalls:z.number().int().min(1).max(3).default(3),maxInputCharacters:z.number().int().min(1).max(24000).default(12000),
 maxToolCharacters:z.number().int().min(1).max(30000).default(16000),maxOutputCharacters:z.number().int().min(1).max(6000).default(2000)}).strict();
import {harnessSkills} from '../../harness/profiles.ts';
/** Bounded knowledge access autonomy; the host still owns planning constraints and candidate acceptance. */
export function createPiQuestionPlanner(config:{cwd:string;modelRuntime:ModelRuntime;model:Model<Api>;knowledgeMode?:'seed'|'reviewed-only'|'draft-preview';timeoutMs?:number;maxToolCalls?:number;
 maxInputCharacters?:number;maxToolCharacters?:number;maxOutputCharacters?:number}){
 const {modelRuntime,model,...rawOptions}=config,parsedOptions=Options.safeParse(rawOptions);
 if(!parsedOptions.success||!modelRuntime||!model)throw new AgentStateError('VALIDATION_ERROR');
 const options=parsedOptions.data;
 return async(raw:unknown,signal:AbortSignal=new AbortController().signal):Promise<PlannerResult>=>{
  const parsed=PlannerInputSchema.safeParse(raw);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  const input=parsed.data,startedAt=Date.now(),policy=input.planningPolicy?.parameters??{};
  if(input.context.roleId!==input.state.roleId||(input.planningPolicy&&input.planningPolicy.roleId!==input.state.roleId))throw new AgentStateError('ROLE_FORBIDDEN');
  if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');
  const deadline=Math.min(input.context.deadlineAt,input.state.deadlineAt,startedAt+options.timeoutMs);
  if(startedAt>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');
  const {plan,provenance}=resolveQuestionPlan(input.state,startedAt,policy,input.askedQuestionIds,input.catalogPin,input.allowDraftKnowledge);
  const binding=provenance?{provenance}:{};
  if(plan.action==='finish')return PlannerResultSchema.parse({kind:'uncommitted-knowledge-plan',selection:{status:'finished',plan,...binding},receipts:[],modelMessages:0});
  const eligible=provenance?eligibleQuestions(input.catalogPin!.items,{roleId:input.state.roleId,skillIds:input.state.skills.filter(s=>s.relevance>0).map(s=>s.skillId),
   askedQuestionIds:input.askedQuestionIds,priorEvidence:input.state.priorEvidence,observations:input.state.observations,allowDraftKnowledge:input.allowDraftKnowledge,targetDifficulty:plan.difficulty}):undefined;
  if(eligible&&!eligible.length)return PlannerResultSchema.parse({kind:'uncommitted-knowledge-plan',selection:{status:'unavailable',plan,...binding,reason:'no_eligible_question'},receipts:[],modelMessages:0});
  const system=(await harnessSkills.load('planning'))+(provenance?'\n'+fallbackGuidance:'');
  const payload={roleId:input.context.roleId,goal:input.goal,plan,skills:estimateSkills(input.state,startedAt),policy,
   memory:[] as ReturnType<typeof projectMemoryForPrompt>};
  if(system.length+JSON.stringify(payload).length>options.maxInputCharacters)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const memoryView=fitMemoryContext(recallStateEvidence(input.state,startedAt),'questioning',memory=>system.length+JSON.stringify({...payload,memory}).length<=options.maxInputCharacters);
  payload.memory=memoryView.memory;
  const prompt=JSON.stringify(payload);
  if(system.length+prompt.length>options.maxInputCharacters)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const execute=input.catalogPin
   ?createKnowledgeExecutor({...input.context,deadlineAt:deadline},{maxCalls:options.maxToolCalls,includeDrafts:input.allowDraftKnowledge,catalog:eligible??input.catalogPin.items,
    ...(provenance?{excludeQuestionIds:[...input.askedQuestionIds,...input.state.priorEvidence.map(o=>o.questionId),...input.state.observations.map(o=>o.questionId)],targetDifficulty:plan.difficulty}:{})})
   :options.knowledgeMode==='seed'
   ?createKnowledgeExecutor({...input.context,deadlineAt:deadline},{maxCalls:options.maxToolCalls,includeDrafts:input.allowDraftKnowledge})
   :createCuratedKnowledgeExecutor({...input.context,deadlineAt:deadline},{maxCalls:options.maxToolCalls,mode:options.knowledgeMode});
  const receipts:ToolReceipt[]=[],retrieved=new Map<string,KnowledgeItem>();
  let release:(()=>void)|undefined;
    let session:AgentSession|undefined,unsubscribe:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  let closed=false,failure:AgentStateError|undefined,toolCalls=0,modelMessages=0,toolCharacters=0,textCharacters=0,settled=false,aborted=false,final:AssistantMessage|undefined;
  let rejectStop!:(error:AgentStateError)=>void;const stop=new Promise<never>((_resolve,reject)=>{rejectStop=reject;});
  const fail=(code:ErrorCode)=>{failure??=new AgentStateError(code);rejectStop(failure);if(session)void session.abort().catch(()=>{});};
  const check=()=>{if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');if(failure)throw failure;
   if(closed||Date.now()>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');};
  const onAbort=()=>fail('RUN_CANCELLED');signal.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>fail('DEADLINE_EXCEEDED'),Math.max(1,deadline-Date.now()));
  const selection=(items:KnowledgeItem[],now=Date.now())=>selectNextQuestion({state:input.state,now,knowledge:items,
   askedQuestionIds:input.askedQuestionIds,planningPolicy:input.planningPolicy,...(input.catalogPin?{catalogPin:input.catalogPin}:{})},{allowDraftKnowledge:input.allowDraftKnowledge});
  const tool:ToolDefinition={name:'query_role_knowledge',label:'当前规划技能知识',description:'Read host-authorized knowledge for the planned skill. Initially omit query and use skillId/limit only. query is an exact literal substring filter, never semantic search. No identity or role arguments.',
   parameters:Type.Unsafe(z.toJSONSchema(PlannerQuerySchema,{io:'input'})),execute:async(callId,rawQuery,toolSignal)=>{
    check();toolCalls++;if(toolCalls>options.maxToolCalls){fail('TOOL_BUDGET_EXCEEDED');throw failure;}
    const query=PlannerQuerySchema.safeParse(rawQuery);
    if(!query.success||query.data.skillId!==plan.skillId||provenance&&toolCalls===1&&query.data.query!==undefined){fail('VALIDATION_ERROR');throw failure;}
    const receipt=await execute(callId,{...query.data,roleId:input.context.roleId,purpose:'questioning'},toolSignal);check();
    if(receipt.status==='error'){fail(receipt.error!.code);throw failure;}
    const items=provenance?receipt.data!.items:receipt.data!.items.filter(item=>selection([item]).status==='selected');
    const filtered:ToolReceipt={...receipt,status:items.length?'ok':'empty',sourceIds:[...new Set(items.flatMap(i=>i.sourceIds))],data:{items,
     ...(receipt.data!.guidance?{guidance:receipt.data!.guidance.filter(g=>items.some(i=>i.id===g.itemId))}:{})}};
    const text=JSON.stringify(filtered);toolCharacters+=text.length;
    if(toolCharacters>options.maxToolCharacters){fail('CONTEXT_BUDGET_EXCEEDED');throw failure;}
    for(const item of items)retrieved.set(item.id,item);receipts.push(filtered);
    return{content:[{type:'text',text}],details:filtered};
   }};
  try{
   const work=(async()=>{
    const created=await createHarnessPiSession({phase:'planning',cwd:options.cwd,modelRuntime,model,systemPrompt:system,toolDefinitions:[tool],signal,businessScope:{roleId:input.context.roleId,skillId:plan.skillId,allowDraftKnowledge:input.allowDraftKnowledge}});
    if(closed||failure||signal.aborted){created.dispose();check();throw new AgentStateError('RUN_CANCELLED');}
    session=created.session;release=created.dispose;
    if(JSON.stringify(session.getCallableToolNames())!==JSON.stringify(['query_role_knowledge']))throw new AgentStateError('INTERNAL_ERROR');
    unsubscribe=session.subscribe(event=>{
     if(event.type==='agent_settled'){settled=true;aborted=event.aborted;}
     if(event.type==='message_update'&&event.assistantMessageEvent.type==='text_delta'){
      textCharacters+=event.assistantMessageEvent.delta.length;if(textCharacters>options.maxOutputCharacters)fail('MODEL_OUTPUT_INVALID');}
     if(event.type==='message_end'&&event.message.role==='assistant'){
      final=event.message;modelMessages++;
      if(modelMessages>options.maxToolCalls+1)fail('TOOL_BUDGET_EXCEEDED');
      if(JSON.stringify(final.content).length>options.maxOutputCharacters)fail('MODEL_OUTPUT_INVALID');
      if(final.content.some(c=>c.type==='toolCall'&&c.name!=='query_role_knowledge'))fail('MODEL_OUTPUT_INVALID');
     }
    });
    check();await session.prompt(prompt);await session.waitForIdle();check();
    if(final?.stopReason==='error')throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
    if(!settled||aborted||!final||final.stopReason!=='stop'||final.content.some(c=>c.type==='toolCall')||!receipts.length)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    const text=final.content.filter(c=>c.type==='text').map(c=>c.text).join('');
    let rawChoice:unknown;try{rawChoice=JSON.parse(text);}catch{throw new AgentStateError('MODEL_OUTPUT_INVALID');}
    const choice=PlannerChoiceSchema.safeParse(rawChoice);if(!choice.success)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    const selected=selection([...retrieved.values()]);
    if(selected.status!=='finished'&&choice.data.questionId!==(selected.status==='selected'?selected.question.id:null))throw new AgentStateError('MODEL_OUTPUT_INVALID');
    check();return created.gate.accept(()=>PlannerResultSchema.parse({kind:'uncommitted-knowledge-plan',selection:selected,receipts,modelMessages,
     contextAudit:{characterCount:system.length+prompt.length,unit:'utf16-code-units',memory:memoryView.audit,historyCompatibility:describeHistoryCompatibility(input.state)}}));
   })();
   return await Promise.race([work,stop]);
  }catch(error){if(error instanceof AgentStateError)throw error;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
  finally{closed=true;if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',onAbort);unsubscribe?.();
   if(session){void session.abort().catch(()=>{});release?.();}}
 };
}
