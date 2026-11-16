import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { basename,join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runOfflineSemanticBenchmark } from '../evals/answers/semantic/runner.ts';
import { renderSemanticMarkdown } from '../evals/answers/semantic/report.ts';
import { loadSemanticDataset,compileSemanticDataset } from '../evals/answers/semantic/dataset.ts';
import { readSemanticReport } from '../evals/answers/semantic/artifacts.ts';
import { createReviewLedger,inspectReviewLedger,recordSemanticReview,reviewOperationTemplate,SemanticReviewError } from '../evals/answers/semantic/reviews.ts';
import { SemanticReviewErrorCodeSchema } from '../packages/contracts/src/semantic-review.ts';
import { readReviewJson } from '../evals/answers/semantic/review-artifacts.ts';
import { createSemanticComparison,verifySemanticComparison,renderSemanticComparison } from '../evals/answers/semantic/comparison.ts';
export function parseSemanticArgs(args:string[]){
 if(!args.length)return{mode:'run' as const};if(args.length===1&&args[0]==='--review')return{mode:'review' as const};
 if(args.length===2&&args[0]==='--verify'&&basename(args[1]!)==='report.json')return{mode:'verify' as const,path:resolve(args[1]!)};
 if(args.length===2&&args[0]==='--review-status'&&basename(args[1]!)==='ledger.json')return{mode:'review-status' as const,path:resolve(args[1]!)};
 if(args.length===3&&args[0]==='--compare'&&basename(args[1]!)==='report.json'&&basename(args[2]!)==='ledger.json')
  return{mode:'compare' as const,reportPath:resolve(args[1]!),ledgerPath:resolve(args[2]!)};
 if(args.length===4&&args[0]==='--verify-comparison'&&basename(args[1]!)==='comparison.json'&&basename(args[2]!)==='report.json'&&basename(args[3]!)==='ledger.json')
  return{mode:'verify-comparison' as const,path:resolve(args[1]!),reportPath:resolve(args[2]!),ledgerPath:resolve(args[3]!)};
 if(args.length===5&&args[0]==='--review-apply'&&basename(args[1]!)==='ledger.json'&&args[3]==='--actor'&&/^[A-Za-z0-9_.-]{1,100}$/.test(args[4]!))
  return{mode:'review-apply' as const,ledgerPath:resolve(args[1]!),operationPath:resolve(args[2]!),actorId:args[4]!};
 throw Error('SEMANTIC_ARGS_INVALID');
}
export async function semanticMain(args:string[]){const config=parseSemanticArgs(args);
 if(config.mode==='verify'){const r=await readSemanticReport(config.path);console.log(JSON.stringify({verified:true,status:r.status,rerun:false,qualityClaimEligible:false}));return r.status==='failed'?1:0;}
 if(config.mode==='review-status'){console.log(JSON.stringify(inspectReviewLedger(await readReviewJson(config.path))));return 0;}
 if(config.mode==='verify-comparison'){
  const[c,r,l]=await Promise.all([readReviewJson(config.path),readSemanticReport(config.reportPath),readReviewJson(config.ledgerPath)]);
  verifySemanticComparison(c,r,l);console.log(JSON.stringify({verified:true,inferenceReexecuted:false,humanReferenceCount:0,qualityClaimEligible:false}));return 0;
 }
 const cache=join(process.cwd(),'.cache','semantic-support');await mkdir(cache,{recursive:true});
 if(config.mode==='compare'){
  const[r,l]=await Promise.all([readSemanticReport(config.reportPath),readReviewJson(config.ledgerPath)]),c=createSemanticComparison(r,l);
  const text=JSON.stringify(c,null,2)+'\n';if(Buffer.byteLength(text)>4*1024*1024)throw Error('SEMANTIC_COMPARISON_INVALID');
  const dir=await mkdtemp(join(cache,'comparison-')),path=join(dir,'comparison.json');
  await writeFile(path,text,{flag:'wx'});await writeFile(join(dir,'comparison.md'),renderSemanticComparison(c),{flag:'wx'});
  verifySemanticComparison(await readReviewJson(path),r,l);
  console.log(JSON.stringify({comparison:path,adoptedCount:c.adoptedCount,unchangedCount:c.unchangedCount,authority:c.authority,inferenceReexecuted:false,humanReferenceCount:0,qualityClaimEligible:false}));return 0;
 }
 if(config.mode==='review-apply'){
  const[old,operation]=await Promise.all([readReviewJson(config.ledgerPath),readReviewJson(config.operationPath)]);
  const ledger=recordSemanticReview(old,operation,{actorId:config.actorId,now:Date.now()}),text=JSON.stringify(ledger,null,2)+'\n';
  if(Buffer.byteLength(text)>4*1024*1024)throw Error('SEMANTIC_REVIEW_FILE_INVALID');
  const dir=await mkdtemp(join(cache,'review-ledger-')),path=join(dir,'ledger.json');
  await writeFile(path,text,{flag:'wx'});const summary=inspectReviewLedger(await readReviewJson(path));
  await writeFile(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({ledger:path,ledgerVersion:ledger.version,authority:summary.authority,humanReferenceCount:0,qualityClaimEligible:false,baselineOverwritten:false}));return 0;
 }
 if(config.mode==='review'){
  const d=compileSemanticDataset(loadSemanticDataset()),dir=await mkdtemp(join(cache,'review-')),ledger=createReviewLedger(Date.now());
  await writeFile(join(dir,'packet.json'),JSON.stringify({datasetId:d.id,datasetDigest:d.digest,reviewStatus:'draft',origin:'assistant-authored-synthetic',
   humanReferenceCount:0,qualityClaimEligible:false,warning:'Includes original synthetic answers and draft labels; exporting is not approval.',samples:d.samples},null,2)+'\n',{flag:'wx'});
  await writeFile(join(dir,'ledger.json'),JSON.stringify(ledger,null,2)+'\n',{flag:'wx'});
  await writeFile(join(dir,'operation-template.json'),JSON.stringify(reviewOperationTemplate(ledger),null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({reviewPacket:join(dir,'packet.json'),ledger:join(dir,'ledger.json'),operationTemplate:join(dir,'operation-template.json'),claims:d.samples.length,humanReferenceCount:0,approvalCreated:false}));return 0;
 }
 const r=await runOfflineSemanticBenchmark(),dir=await mkdtemp(join(cache,'run-')),path=join(dir,'report.json');
 await writeFile(join(dir,'report.md'),renderSemanticMarkdown(r),{flag:'wx'});await writeFile(path,JSON.stringify(r,null,2)+'\n',{flag:'wx'});await readSemanticReport(path);
 console.log(JSON.stringify({status:r.status,summary:r.summary,draftAgreement:r.analysis.accuracy,unsupportedAcceptanceRate:r.analysis.unsupportedAcceptanceRate,
  qualityClaimEligible:false,humanReferenceCount:0,liveModelCalls:0,report:path}));return r.status==='failed'?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await semanticMain(process.argv.slice(2));}
 catch(e){const code=SemanticReviewErrorCodeSchema.safeParse(e instanceof SemanticReviewError?e.code:undefined);console.error(code.success?code.data:'SEMANTIC_EXECUTION_FAILED');process.exitCode=2;}}
