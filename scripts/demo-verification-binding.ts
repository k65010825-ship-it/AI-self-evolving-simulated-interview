import {pathToFileURL} from 'node:url';
import {verificationScenario} from '../experiments/verification-binding/fixture.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {buildInterviewReport} from '../apps/agent/src/reporting/build-report.ts';
/** Two synthetic roles, actual Pi SDK, deterministic local provider; no real-user or supplier inference. */
export async function runVerificationBindingDemo(){
 const rows=[];
 for(const roleId of ['java-backend','web-frontend'] as const){
  const f=verificationScenario(roleId),provider=await createEvaluationFixture(()=>({text:JSON.stringify(f.assessment)}));
  const evaluate=createPiEvaluator({cwd:process.cwd(),roleId,modelRuntime:provider.runtime,model:provider.model});
  const proposal=await evaluateTurn(f.input,{evaluate,now:()=>f.at});
  const report=await buildInterviewReport({state:proposal.nextState,generatedAt:f.at+1,policyVersion:'synthetic-policy',skillLabels:{[f.input.question.skillId]:'合成验证目标'},turns:[{input:f.input,proposal,evidenceMode:'offline-fixture'}]});
  const dimension=report.assessments[0]!.evaluation.dimensions[0]!;
  if(!dimension.verificationBinding||provider.stats.liveModelCalls!==0)throw Error('VERIFICATION_DEMO_INVALID');
  rows.push({roleId,goalId:dimension.verificationBinding.goalId,goalVersion:dimension.verificationBinding.goalVersion,mode:dimension.verificationBinding.mode,normalizedScore:dimension.normalizedScore,semanticSupport:'not_verified' as const});
 }
 return {origin:'assistant-authored-synthetic-development' as const,liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runVerificationBindingDemo(),null,2));
