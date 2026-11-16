import { test,expect } from 'bun:test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSemanticReport } from '../evals/answers/semantic/artifacts.ts';
import { runSemanticBenchmark } from '../evals/answers/semantic/runner.ts';
import { contentHash } from '../evals/answers/validation.ts';
test('semantic report reader rejects malformed UTF8 and oversized data with static errors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'semantic-artifact-')),path=join(dir,'report.json');
 try{await writeFile(path,Buffer.from([0xff]));await expect(readSemanticReport(path)).rejects.toThrow('SEMANTIC_ARTIFACT_INVALID');
  await writeFile(path,'x'.repeat(4*1024*1024+1));await expect(readSemanticReport(path)).rejects.toThrow('SEMANTIC_ARTIFACT_INVALID');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a source fingerprint forged consistently with report digest still cannot verify against current files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'semantic-source-')),path=join(dir,'report.json');
 try{const report=await runSemanticBenchmark({judge:async()=>({verdict:'uncertain'})});
  report.sourceManifest[0]!.sha256='0'.repeat(64);const{digest,...body}=report;report.digest=contentHash(body);
  await writeFile(path,JSON.stringify(report));await expect(readSemanticReport(path)).rejects.toThrow('SEMANTIC_ARTIFACT_INVALID');
 }finally{await rm(dir,{recursive:true,force:true});}
},30000);
