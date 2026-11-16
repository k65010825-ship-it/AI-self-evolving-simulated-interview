import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runEvidenceSupportMatrix } from '../evals/answers/evidence-support/runner.ts';
if(process.argv.slice(2).length){console.error('EVIDENCE_MATRIX_ARGS_INVALID');process.exitCode=2;}
else {
 const report=runEvidenceSupportMatrix(),root=join(process.cwd(),'.cache','evidence-support-matrix');
 await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'run-')),file=join(dir,'report.json');
 await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,summary:report.summary,report:file,
  humanReferenceCount:0,qualityClaimEligible:false,liveModelCalls:0}));
 process.exitCode=report.summary.failed?1:0;
}
