import { test,expect } from 'bun:test';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReviewJson } from '../evals/answers/semantic/review-artifacts.ts';
import { createReviewLedger,inspectReviewLedger } from '../evals/answers/semantic/reviews.ts';
import { parseSemanticArgs,semanticMain } from '../scripts/semantic-support.ts';
test('review CLI imports to a fresh ledger and leaves input file unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'review-ledger-')),path=join(dir,'ledger.json'),operationPath=join(dir,'operation.json');
 try{const ledger=createReviewLedger(Date.now()-100),v=inspectReviewLedger(ledger).claims[0]!;
  const op={operationId:'synthetic-cli',expectedLedgerVersion:0,claimId:v.claimId,expectedLabelVersion:0,requestDigest:v.requestDigest,labelDigest:v.labelDigest,occurredAt:Date.now(),
   action:{kind:'revise_label',reference:{verdict:v.verdict,rationale:'合成CLI修订演练，不代表实际审核'},changeReason:'测试新增label版本'}};
  const original=JSON.stringify(ledger);await writeFile(path,original);await writeFile(operationPath,JSON.stringify(op));
  expect(await semanticMain(['--review-apply',path,operationPath,'--actor','synthetic-author'])).toBe(0);
  expect(await readFile(path,'utf8')).toBe(original);
  expect(parseSemanticArgs(['--review-status',path]).mode).toBe('review-status');
  expect(()=>parseSemanticArgs(['--review-apply',path,operationPath,'--actor','bad actor'])).toThrow('SEMANTIC_ARGS_INVALID');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('review JSON reader rejects oversized or malformed input before importing records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'review-file-')),path=join(dir,'input.json');
 try{await writeFile(path,Buffer.from([0xff]));await expect(readReviewJson(path)).rejects.toThrow('SEMANTIC_REVIEW_FILE_INVALID');
  await writeFile(path,'x'.repeat(4*1024*1024+1));await expect(readReviewJson(path)).rejects.toThrow('SEMANTIC_REVIEW_FILE_INVALID');
 }finally{await rm(dir,{recursive:true,force:true});}
});
