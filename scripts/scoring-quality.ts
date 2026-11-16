import {resolve,join,dirname,basename} from 'node:path';import {pathToFileURL} from 'node:url';
import {prepareScoringQualityBatch,readScoringQualityBatch,qualityJson,scoringQualityAuthorization} from '../evals/scoring-quality/batch.ts';
import {executeScoringQuality,inspectScoringQuality} from '../evals/scoring-quality/runner.ts';
import {scoringQualityFixture} from '../experiments/scoring-quality/fixture.ts';
import {compareScoringQuality} from '../evals/scoring-quality/stability.ts';
export function parseScoringQualityArgs(args:string[]){
 if(args.length===0||args.length===1&&args[0]==='prepare')return{command:'prepare' as const};
 if(args.length===1&&args[0]==='demo')return{command:'demo' as const};
 if(args.length===3&&args[1]==='--suite'&&(args[2]==='contrast'||args[2]==='challenge')&&args[0]==='prepare')return{command:'prepare',suite:args[2]}as const;
 if(args.length===3&&args[1]==='--suite'&&(args[2]==='contrast'||args[2]==='challenge')&&args[0]==='demo')return{command:'demo',suite:args[2]}as const;
 if(args.length===2&&args[0]==='inspect')return{command:'inspect' as const,directory:resolve(args[1]!)};
 if(args.length===3&&args[0]==='compare')return{command:'compare' as const,left:resolve(args[1]!),right:resolve(args[2]!)};
 if(args.length===5&&args[0]==='execute'&&args[2]==='--authorization'&&args[4]==='--execute')return{command:'execute' as const,directory:resolve(args[1]!),authorization:resolve(args[3]!)};
 throw Error('SCORING_QUALITY_ARGS_INVALID');
}
export async function scoringQualityMain(args:string[],deps:{environment?:(name:string)=>string|undefined;log?:(v:unknown)=>void}={}){
 const p=parseScoringQualityArgs(args),log=deps.log??(v=>console.log(JSON.stringify(v)));
 if(p.command==='prepare'){const r=await prepareScoringQualityBatch('suite'in p?{suite:p.suite}:{});log({output:r.output,batchDigest:r.batch.digest,suite:r.batch.suite??'baseline',cases:8,maxRequests:6,maxDeclaredCostMicros:2000000,authorizationEnabled:false,credentialInspection:'not-performed'});return 0;}
 if(p.command==='inspect'){const r=await inspectScoringQuality(p.directory);log({status:r.report.status,scope:r.report.scope,mode:r.report.mode,totals:r.report.totals,analysis:r.report.analysis,qualityClaimEligible:false,credentialInspection:'not-performed'});return 0;}
 if(p.command==='compare'){const r=await compareScoringQuality(p.left,p.right);log(r);return r.draftStabilityPassed?0:1;}
 if(p.command==='demo'){const r=await prepareScoringQualityBatch({outputRoot:'.cache/scoring-quality-rehearsal',...('suite'in p?{suite:p.suite}:{})}),done=await executeScoringQuality(r.output,scoringQualityAuthorization(r.batch,'injected-test-only',Date.now()+600000),{readCredential:()=> 'synthetic-scoring-quality-only',fetch:scoringQualityFixture()},{execute:true,mode:'injected-test-only'});
  log({output:done.output,status:done.report.status,mode:'injected-http',syntheticHttpAttempts:done.report.totals.httpAttempts,realHttpAttempts:0,analysis:done.report.analysis});return done.report.status==='passed-draft-checks'?0:1;}
 if(dirname(p.authorization)!==p.directory||basename(p.authorization)!=='authorization.json')throw Error('SCORING_QUALITY_AUTHORIZATION_PATH');
 await readScoringQualityBatch(p.directory);const authorization=await qualityJson(p.authorization);
 const result=await executeScoringQuality(p.directory,authorization,{readCredential:name=>name==='INTERVIEW_QIANWEN_API_KEY'?(deps.environment??(n=>process.env[n]))(name):undefined},{execute:true,mode:'live'});
 log({report:join(result.output,'report.json'),status:result.report.status,totals:result.report.totals,outcomeAgreement:result.report.analysis.expectedOutcomeMatched,qualityClaimEligible:false});return result.report.status==='passed-draft-checks'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await scoringQualityMain(process.argv.slice(2));}catch{console.error('SCORING_QUALITY_CLI_FAILED');process.exitCode=2;}}
