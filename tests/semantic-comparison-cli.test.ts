import { test,expect } from 'bun:test';
import { mkdtemp,writeFile,readFile,readdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSemanticBenchmark } from '../evals/answers/semantic/runner.ts';
import { createReviewLedger } from '../evals/answers/semantic/reviews.ts';
import { parseSemanticArgs,semanticMain } from '../scripts/semantic-support.ts';
const cache=join(process.cwd(),'.cache','semantic-support');
test('comparison CLI creates isolated artifacts, verifies readonly and preserves both inputs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'semantic-shadow-')),rp=join(dir,'report.json'),lp=join(dir,'ledger.json');
 try{
  const report=await runSemanticBenchmark({judge:async()=>({verdict:'supported'})}),ledger=createReviewLedger(1000);
  const reportText=JSON.stringify(report),ledgerText=JSON.stringify(ledger);await writeFile(rp,reportText);await writeFile(lp,ledgerText);
  const before=new Set(await readdir(cache));expect(await semanticMain(['--compare',rp,lp])).toBe(0);
  const created=(await readdir(cache)).filter(n=>n.startsWith('comparison-')&&!before.has(n));expect(created.length).toBe(1);
  const path=join(cache,created[0]!,'comparison.json'),text=await readFile(path,'utf8');
  expect(await semanticMain(['--verify-comparison',path,rp,lp])).toBe(0);expect(await readFile(path,'utf8')).toBe(text);
  expect(await readFile(rp,'utf8')).toBe(reportText);expect(await readFile(lp,'utf8')).toBe(ledgerText);
  expect(()=>parseSemanticArgs(['--compare',rp])).toThrow('SEMANTIC_ARGS_INVALID');
  const bad=JSON.parse(text);bad.humanReferenceCount=1;await writeFile(path,JSON.stringify(bad));
  await expect(semanticMain(['--verify-comparison',path,rp,lp])).rejects.toThrow('SEMANTIC_COMPARISON_INVALID');
 }finally{await rm(dir,{recursive:true,force:true});}
},30000);
