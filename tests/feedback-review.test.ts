import {beforeAll,expect,test} from 'bun:test';
import {reviewCapacityClaim,reviewFeedback} from '../apps/agent/src/evaluation/feedback-review.ts';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {qualityFixtureFetch} from '../experiments/quality-batch/fixture.ts';
import {inspectFeedbackBatch,exportFeedbackReview} from '../evals/quality-batch/feedback-review.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {contentHash} from '../evals/answers/validation.ts';
let directory:string;
beforeAll(async()=>{
 const p=await prepareQualityBatch();directory=p.output;
 const config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};
 await writeFile(join(directory,'config.authorized.json'),JSON.stringify(config));
 await executeQualityBatch(directory,config,{readCredential:()=> 'synthetic-only',fetch:qualityFixtureFetch});
},30000);
const load=async(name:string)=>JSON.parse(await readFile(join(directory,name),'utf8'));

test('explicit normative capacity claims distinguish remaining slots from initial count',()=>{
 expect(reviewCapacityClaim('初值99时正确最大成功数应为99而非100；需修正该数值错误并解释为何不能超额到100')).toEqual({status:'contradiction',expected:1,observed:99});
 expect(reviewCapacityClaim('初值99时正确最大成功数应为1。')).toEqual({status:'matched-restricted-claim',expected:1,observed:1});
});
test('bound profile flags arithmetic while every citation remains pending and original scores stay unchanged',async()=>{
 const input=(await load('java-backend-wrong.request.json')).job.input;
 const proposal=(await load('report.json')).rows.find((r:{role:string;stage:string})=>r.role==='java-backend'&&r.stage==='wrong').snapshot.result.proposal;
 proposal.feedback={strengths:['认识竞态并发窗口'],improvements:['正确最大成功数应为99。']};
 const before=contentHash(proposal),r=reviewFeedback(input,proposal);
 expect(r.profile?.id).toBe('java-capacity-remaining-v1');expect(r.status).toBe('blocked-fact-contradiction');
 expect(r.items[0]!.concern).toBe('race-awareness-without-literal-answer-cue');
 expect(r.items.every(i=>i.citationSupport==='independent-review-required')).toBe(true);expect(contentHash(proposal)).toBe(before);
 input.question.text+='变更';expect(reviewFeedback(input,proposal).profile).toBeNull();
});
test('invalid proposal identity and invented evidence fail closed',async()=>{
 const input=(await load('java-backend-wrong.request.json')).job.input;
 const proposal=(await load('report.json')).rows[0].snapshot.result.proposal;
 const wrong=structuredClone(proposal);wrong.basedOn.answerId='another';expect(()=>reviewFeedback(input,wrong)).toThrow();
 const invented=structuredClone(proposal);invented.evidence[0].excerpt='不存在的证据';expect(()=>reviewFeedback(input,invented)).toThrow();
});
test('historical reader exports blind tasks without model scores or automatic labels',async()=>{
 const r=await inspectFeedbackBatch(directory);
 expect(r.reviews.length).toBeGreaterThan(0);expect(r.qualityClaimEligible).toBe(false);expect(r.liveModelCalls).toBe(0);
 expect(r.reviewBundle.reviewPacket.tasks.every(t=>!('modelScore' in t)&&!('fact' in t.payload)&&!('concern' in t.payload))).toBe(true);
 expect(r.reviewBundle.reviewPacket.labelTemplate.every(t=>t.reviewerId===null&&t.citationSupported===null)).toBe(true);
});
test('changed report and rehashed but mismatched original request are rejected',async()=>{
 const path=join(directory,'report.json'),original=await readFile(path,'utf8'),r=JSON.parse(original);r.rows[0].requestDigest='0'.repeat(64);
 await writeFile(path,JSON.stringify(r));try{await expect(inspectFeedbackBatch(directory)).rejects.toThrow('FEEDBACK_REVIEW_DIGEST_INVALID');}finally{await writeFile(path,original);}
 const {digest:ignored,...body}=r;void ignored;r.digest=contentHash(body);
 await writeFile(path,JSON.stringify(r));try{await expect(inspectFeedbackBatch(directory)).rejects.toThrow('FEEDBACK_REVIEW_REQUEST_INVALID');}finally{await writeFile(path,original);}
});
test('feedback exporter keeps source files unchanged and separates display projection from private review material',async()=>{
 const before=await readFile(join(directory,'report.json'),'utf8'),result=await exportFeedbackReview(directory);
 const display=JSON.parse(await readFile(join(result.output,'display-feedback.json'),'utf8'));
 expect(display.sourceReportDigest).toBe(JSON.parse(before).digest);expect(display.qualityClaimEligible).toBe(false);
 expect(display.turns.every((t:{publication:{semanticSupport:string};items?:unknown})=>t.publication.semanticSupport==='not_verified'&&!('items' in t))).toBe(true);
 expect(await readFile(join(directory,'report.json'),'utf8')).toBe(before);expect(result.liveModelCalls).toBe(0);
});
test('negative, quoted, unsafe and unknown claims are not silently approved',()=>{
 for(const text of ['初值99。','get/check/set实际可能成功100次。','并非正确最大成功数应为99。','“正确最大成功数应为99”是错误结论。','正确最大成功数不应为99。','正确最大成功数应为1但也可能为99。','正确最大成功数应为99；上述说法错误。','正确最大成功数应为999999999999999999999。'])
  expect(reviewCapacityClaim(text).status).toBe('not-covered');
});

