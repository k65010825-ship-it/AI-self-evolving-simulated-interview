import {pathToFileURL} from 'node:url';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readEvaluationJson,describeEvaluationJsonShape} from '../apps/agent/src/evaluation/read-json.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {groundQuotedEvaluation} from '../apps/agent/src/evaluation/quoted-spans.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';
export function runOutputDiagnosticDemo(){
 const samples=[['valid-object','{"private-key":1}'],['unclosed-container','{"private-key":1'],['unclosed-string','{"private-key":"x'],
  ['dangling-escape','{"private-key":"x'+String.fromCharCode(92)],['mismatched','{"private-key":[1}'],['balanced-syntax','{"private-key":1,}'],
  ['fenced-syntax','```json\n{"private-key":1,}\n```'],['trailing-content','{"private-key":1} private-text']];
 const json=samples.map(([caseId,text])=>{const r=readEvaluationJson(text!,'json-fence-only');return{caseId,accepted:r.ok,...(!r.ok?{jsonIssue:r.jsonIssue}:{}),jsonShape:describeEvaluationJsonShape(text!)};});
 const binding=[];
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role),g=groundQuotedEvaluation(f.wire,f.text);if(!g.ok)throw Error('DEMO_FIXTURE_INVALID');const b=g.output.criterionScores[0]!.verificationBinding!,goal=f.input.rubric.criteria[0]!.verificationGoal;
  const variants=[['valid',b],['procedure-overlap',{...b,target:b.action}],['observation-overlap',{...b,observation:{...b.observation!,value:b.observation!.metric}}]] as const;
  for(const[caseId,proposal]of variants)binding.push({role,caseId,...inspectVerificationBinding(goal,proposal,g.output.evidence,['unit'],f.text)});
 }
 const result={mode:'offline-synthetic-minimal-output-regressions' as const,json,binding,liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,historicalFailedTextReconstructed:false};
 if(JSON.stringify(result).includes('private-')||json.filter(r=>r.accepted).length!==1||binding.filter(b=>b.status==='bound').length!==2)throw Error('OUTPUT_DIAGNOSTIC_DEMO_FAILED');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==2)throw Error();const result=runOutputDiagnosticDemo(),body={version:1,...result,sourceManifest:await collectDeliverySources(process.cwd())};
  const root=resolve('.cache/output-diagnostics');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
  await writeFile(join(output,'report.json'),JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,jsonCases:result.json.length,bindingCases:result.binding.length,liveModelCalls:0,qualityClaimEligible:false,historicalFailedTextReconstructed:false}));
 }catch{console.error('OUTPUT_DIAGNOSTIC_DEMO_FAILED');process.exitCode=2;}
}
