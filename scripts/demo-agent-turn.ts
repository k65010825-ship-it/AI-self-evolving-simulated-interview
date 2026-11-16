import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import { evaluateTurnWithClarification } from '../apps/agent/src/orchestration/clarify-turn.ts';
import { createPiEvaluator } from '../apps/agent/src/adapters/pi/evaluator.ts';
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { contentText } from '../experiments/pi-sdk/planner-fixture.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
import { pathToFileURL } from 'node:url';
export async function runClarificationDemo(roleId:RoleId='java-backend'){
 const now=Date.now(),skillId=roleId==='java-backend'?'spring-transactions':'async-state';
 const state=createInterviewState({sessionId:'clarification-demo',roleId,durationMinutes:20,skills:[{skillId,relevance:1}]},now);
 const f=await createEvaluationFixture(context=>{
  const payload=JSON.parse(contentText(context.messages.find(m=>m.role==='user')!.content)),complete=payload.interview.answer.text.includes('补充');
  return{text:JSON.stringify({evidence:complete?[{id:'e',start:0,end:4,excerpt:'边界条件'}]:[],
   criterionScores:['correctness','depth'].map(criterionId=>({criterionId,score:complete?2:null,evidenceIds:complete?['e']:[]})),
   feedback:{strengths:[],improvements:['补充说明']} })};
 });
 const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId});
 const input={state,expectedVersion:0,observationId:'clarification-observation',goal:'澄清演练',quality:1,knowledge:[],
  context:{userId:'demo',roleId,runId:'clarification-first',attemptId:'a1',deadlineAt:now+60000},answer:{id:'answer-1',text:'边界条件'},
  question:{id:'demo-q',roleId,skillId,questionType:'technical',difficulty:2,text:'说明边界条件及处理过程'},
  rubric:{id:'demo-rubric',version:'1',roleId,scope:'technical-content',criteria:[{id:'correctness',maxScore:4,weight:.5,required:true},{id:'depth',maxScore:4,weight:.5,required:true}]}};
 const before=JSON.stringify(input),first=await evaluateTurnWithClarification(input,{evaluate,now:()=>now},{});
 if(first.status!=='needs_clarification')throw Error('CLARIFICATION_DEMO_INVALID');
 const supplemental={...input,answer:{id:'answer-2',text:'边界条件\n补充：我会说明判断理由与处理步骤。'},context:{...input.context,runId:'clarification-second',attemptId:'a2'}};
 const second=await evaluateTurnWithClarification(supplemental,{evaluate,now:()=>now+1000},{previous:first});
 if(second.status!=='scored'||JSON.stringify(input)!==before)throw Error('CLARIFICATION_DEMO_INVALID');
 return{roleId,firstStatus:first.status,attempt:first.attempt,secondStatus:second.status,normalizedScore:second.proposal.evaluation.normalizedScore,
  observations:second.proposal.nextState.observations.length,originalVersion:state.version,liveModelCalls:f.stats.liveModelCalls,providerCalls:f.stats.providerCalls,committed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
// Deterministic fixture: these grades are supplied, not inferred by a real model.
const now = 1000000;
const state = createInterviewState({ sessionId: 'offline-turn-demo', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: 1 }, { skillId: 'java-concurrency', relevance: 1 }] }, now);
const proposal = await evaluateTurn({ state, expectedVersion: 0, observationId: 'demo-observation', goal: '练习事务',
  context: { userId: 'demo-user', runId: 'demo-run', attemptId: 'demo-attempt', roleId: 'java-backend', deadlineAt: now + 60000 },
  question: { id: 'demo-question', roleId: 'java-backend', skillId: 'spring-transactions',
    text: '如何界定事务边界？', questionType: 'technical', difficulty: 2 },
  answer: { id: 'demo-answer', text: '事务边界应覆盖一致性要求。' }, quality: 0.8, knowledge: [],
  rubric: { id: 'demo-content', version: 'draft-1', roleId: 'java-backend', scope: 'technical-content',
    criteria: [{ id: 'correctness', maxScore: 4, weight: 0.75, required: true },
      { id: 'depth', maxScore: 4, weight: 0.25, required: true }] },
}, { now: () => now, evaluate: async (_request, signal) => {
  signal.throwIfAborted();
  return { evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '事务边界' }], criterionScores: [
    { criterionId: 'correctness', score: 4, evidenceIds: ['e1'] },
    { criterionId: 'depth', score: 2, evidenceIds: ['e1'] }],
    feedback: { strengths: ['提及事务边界'], improvements: ['补充异常回滚条件与外部系统一致性处理'] } };
} });
console.log(JSON.stringify({ mode: 'offline-turn-fixture', liveModelCalls: 0,
  committed: false, originalVersion: state.version, proposal }, null, 2));
for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runClarificationDemo(role)));
}
