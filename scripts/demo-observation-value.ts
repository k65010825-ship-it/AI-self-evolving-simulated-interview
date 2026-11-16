import {pathToFileURL} from 'node:url';
import {observationScenario,observationVariants} from '../experiments/verification-binding/observation-fixture.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
/** Contract probes with injected annotations; neither extraction accuracy nor independent quality. */
export function runObservationValueDemo(){
 const rows=[];
 for(const roleId of ['java-backend','web-frontend'] as const)for(const variant of observationVariants){
  const f=observationScenario(roleId,variant);
  const result=inspectVerificationBinding(f.goal,f.binding,f.assessment.evidence,['unit'],f.input.answer.text);
  if((result.status==='bound')!==f.expectedBound)throw Error('OBSERVATION_DEMO_MISMATCH');
  rows.push({roleId,variant,status:result.status,reason:'reason' in result?result.reason:null});
 }
 return {origin:'assistant-authored-synthetic-development',annotationMode:'injected-spans',liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,semanticSupport:'not_verified',rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(runObservationValueDemo(),null,2));
