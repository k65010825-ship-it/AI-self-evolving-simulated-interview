import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {readLiveServiceConfig} from '../apps/agent/src/model-access/read-live-config.ts';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);
  if(!args.length||args.length===1&&args[0]==='prepare'){
   const p=await prepareQualityBatch();console.log(JSON.stringify({output:p.output,batchId:p.batch.id,digest:p.batch.digest,model:p.config.profile.modelId,endpoint:p.config.profile.endpoint,credentialEnvironment:p.config.profile.credentialSource.name,maxRequests:6,maxDeclaredCostMicros:2000000,authorizationEnabled:false,credentialInspection:'not-performed',liveModelCalls:0}));
  }else if(args.length===5&&args[0]==='--batch'&&args[2]==='--config'&&args[4]==='--execute'){
   const report=await executeQualityBatch(resolve(args[1]!),await readLiveServiceConfig(resolve(args[3]!)),{readCredential:n=>process.env[n]},{execute:true});
   console.log(JSON.stringify({mode:report.mode,summary:report.summary,digest:report.digest,humanReferenceCount:0,qualityClaimEligible:false}));if(report.summary.stoppedForAccounting||report.summary.failedJobs)process.exitCode=1;
  }else throw Error();
 }catch{console.error('QUALITY_BATCH_FAILED');process.exitCode=2;}
}
