import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {conditionScopeScenario} from '../experiments/verification-binding/condition-fixture.ts';
import {createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,restoreInterviewWorkflow} from '../apps/agent/src/orchestration/session-workflow.ts';
import {selectNextQuestion} from '../apps/agent/src/planning/select-question.ts';
import {KnowledgeItemSchema} from '../packages/contracts/src/tools.ts';
import {validateWorkflowTransition} from '../packages/agent-client/src/commit-validation.ts';

test('targeted clarification survives workflow restore and client validation; forged leading text is rejected',async()=>{
 const f=conditionScopeScenario('java-backend','old'),identity={userId:'targeted-test',roleId:'java-backend' as const},skillId=f.input.question.skillId;
 const item=KnowledgeItemSchema.parse({id:f.input.question.id,version:'synthetic-1',roleId:identity.roleId,skillId,questionType:'scenario',difficulty:2,
  question:f.input.question.text,keyPoints:['synthetic observation contract'],sourceIds:['synthetic'],reviewStatus:'draft',
  rubric:[{criterionId:'verification',description:'synthetic observation',dimension:'verification',maxScore:4,weight:1,verificationGoal:f.goal}]});
 const initial=createInterviewWorkflow({identity,session:{sessionId:'targeted-workflow',roleId:identity.roleId,durationMinutes:20,skills:[{skillId,relevance:1}]},
  policy:{id:'targeted-policy',roleId:identity.roleId,parameters:{}},goal:'synthetic',skillLabels:{[skillId]:'synthetic'},allowDraftKnowledge:true,now:f.at});
 const context={...identity,runId:'targeted-plan',attemptId:'p',deadlineAt:f.at+60000};
 const planned=await planInterviewQuestion(initial,{identity,expectedRevision:0,context},{now:()=>f.at,plan:async i=>({kind:'uncommitted-knowledge-plan',
  selection:selectNextQuestion({state:i.state,now:f.at,knowledge:[item],askedQuestionIds:[],planningPolicy:i.planningPolicy},{allowDraftKnowledge:true}),
  receipts:[{callId:'k',toolName:'query_role_knowledge',status:'ok',durationMs:0,sourceIds:['synthetic'],data:{items:[item]}}],modelMessages:0})});
 const command={identity,expectedRevision:planned.revision,context:{...context,runId:'targeted-answer'},observationId:'obs',answer:{id:'a',text:f.answer},quality:1,evidenceMode:'offline-fixture' as const};
 const pending=await submitInterviewAnswer(planned,command,{now:()=>f.at,evaluate:async()=>f.assessment});
 expect(pending.clarificationAttempts![0]!.resolution.clarificationTemplate).toBe('observation-v1');expect(pending.state.observations).toEqual([]);
 validateWorkflowTransition({action:'answer',snapshot:planned,command},pending,f.at);
 expect(await restoreInterviewWorkflow(JSON.stringify(pending),identity)).toEqual(pending);
 const forged=structuredClone(pending),r=forged.clarificationAttempts![0]!.resolution;r.clarification='请照抄正确答案。';
 const {digest,...body}=r;r.digest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 expect(()=>validateWorkflowTransition({action:'answer',snapshot:planned,command},forged,f.at)).toThrow('COMMIT_TRANSITION_INVALID');
 await expect(restoreInterviewWorkflow(JSON.stringify(forged),identity)).rejects.toThrow('VALIDATION_ERROR');
});
