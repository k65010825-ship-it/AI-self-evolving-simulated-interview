import {pathToFileURL} from 'node:url';
import {conditionScopeScenario} from '../experiments/verification-binding/condition-fixture.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
export function runConditionScopeDemo(){
 const rows=[];
 for(const role of ['java-backend','web-frontend'] as const){
  for(const variant of ['before','after','history','decimal','old','else','separate','another','distant','known-limit']){
   const f=conditionScopeScenario(role,variant),result=inspectVerificationBinding(f.goal,f.binding,f.evidence,['unit'],f.answer);
   const knownLimit=variant==='known-limit',expectedBound=['before','after','history','decimal'].includes(variant);
   if(!knownLimit&&(result.status==='bound')!==expectedBound)throw Error('CONDITION_SCOPE_DEMO_MISMATCH');
   rows.push({role,variant,lane:knownLimit?'known-limit':'regression',expectedBound,actualBound:result.status==='bound',reason:'reason'in result?result.reason:null});
  }
 }
 return {origin:'assistant-authored-synthetic-development',annotationMode:'injected-spans',humanReferenceCount:0,liveModelCalls:0,qualityClaimEligible:false,semanticSupport:'not_verified',rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(runConditionScopeDemo(),null,2));
