import {pathToFileURL} from 'node:url';
import {conditionScopeScenario} from '../experiments/verification-binding/condition-fixture.ts';
import {evaluateTurnWithClarification,validateClarificationReceipt} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {TurnInputSchema} from '../packages/contracts/src/evaluation.ts';
export async function runTargetedClarificationDemo(){
 const rows=[];
 for(const role of ['java-backend','web-frontend']as const){
  const f=conditionScopeScenario(role,'old');let evaluatorCalls=0;
  const r=await evaluateTurnWithClarification(f.input,{now:()=>f.at,evaluate:async()=>{evaluatorCalls++;return f.assessment;}});
  if(r.status!=='needs_clarification'||r.clarificationTemplate!=='observation-v1'||evaluatorCalls!==1)throw Error('CLARIFICATION_DEMO_INVALID');
  validateClarificationReceipt(TurnInputSchema.parse(f.input),r);
  rows.push({role,template:r.clarificationTemplate,prompt:r.clarification,evaluatorCalls,normalizedScore:r.normalizedScore});
 }
 return {origin:'assistant-authored-synthetic-development',liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runTargetedClarificationDemo(),null,2));
