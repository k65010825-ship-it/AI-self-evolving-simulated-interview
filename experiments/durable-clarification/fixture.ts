import {AgentRunRequestSchema} from '../../packages/contracts/src/agent-run.ts';
import {conditionScopeScenario} from '../verification-binding/condition-fixture.ts';
import {observationScenario} from '../verification-binding/observation-fixture.ts';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
import type {UnscoredTurn} from '../../packages/contracts/src/clarification.ts';
export function initialClarificationRequest(role:RoleId){
 const f=conditionScopeScenario(role,'old'),runId='durable-clarification-'+role+'-1';
 const context={...f.input.context,runId};
 return {request:AgentRunRequestSchema.parse({inputSnapshotId:runId,context,job:{type:'turn',input:{...f.input,context},knowledge:[],askedQuestionIds:[],allowDraftKnowledge:true,clarification:{}}}),output:f.assessment};
}
export function continuationRequest(first:ReturnType<typeof initialClarificationRequest>['request'],previous:UnscoredTurn){
 if(first.job.type!=='turn')throw Error('DURABLE_CLARIFICATION_FIXTURE_INVALID');
 const f=observationScenario(first.context.roleId),prefix=first.job.input.answer.text+'\n',answer=prefix+f.input.answer.text;
 const offset=(p:{evidenceId:string;start:number;end:number})=>({...p,start:p.start+prefix.length,end:p.end+prefix.length});
 const b=f.binding,verificationBinding={...b,action:offset(b.action),target:offset(b.target),expectation:offset(b.expectation),observation:{metric:offset(b.observation.metric),value:offset(b.observation.value),condition:offset(b.observation.condition)}};
 const context={...first.context,runId:first.context.runId+'-continue',attemptId:'continue'};
 const request=AgentRunRequestSchema.parse({...first,inputSnapshotId:context.runId,context,job:{...first.job,input:{...first.job.input,context,answer:{id:'continued-answer',text:answer}},clarification:{previous}}});
 return {request,output:{...f.assessment,evidence:[{id:'unit',start:prefix.length,end:answer.length,excerpt:f.input.answer.text}],criterionScores:[{...f.assessment.criterionScores[0]!,verificationBinding}]}};
}
/** Injected wire response exercises the real SDK/parser/meter but never calls a supplier. */
export function fixtureStream(output:unknown){return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}]})+'\n\n'+
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
