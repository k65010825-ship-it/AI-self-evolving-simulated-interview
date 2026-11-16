import { test,expect } from 'bun:test';
import { supportCases } from '../evals/answers/evidence-support/cases.ts';
import { evidenceSupportRejection } from '../packages/interview-domain/src/evidence-support.ts';
import { createScoringExecutor } from '../apps/agent/src/tools/scoring-executor.ts';
for(const c of supportCases.filter(c=>c.lane==='regression')) test(`evidence matrix: ${c.id}`,()=>{
 expect(evidenceSupportRejection(c.dimension?{dimension:c.dimension}:{},c.quotes,c.quotes.join('\n'))).toBe(c.expected);
});
test('mixed citations remove no-answer IDs without discarding substantive verification',async()=>{
 const text='不知道。注入超时并检查页面是否提示重试。';const quotes=['不知道。','注入超时并检查页面是否提示重试。'];
 const evidence=quotes.map((excerpt,i)=>({id:`e${i}`,start:text.indexOf(excerpt),end:text.indexOf(excerpt)+excerpt.length,excerpt}));
 const execute=createScoringExecutor({userId:'u',roleId:'web-frontend',runId:'r',attemptId:'a',deadlineAt:1000,answerId:'a',answerText:text,evidence},
 [{id:'r',version:'1',roleId:'web-frontend',scope:'technical-content',criteria:[{id:'v',dimension:'verification',maxScore:4,weight:1,required:true}]}],{allowRequiredAbstention:true});
 for(const ids of [['e0','e1'],['e1','e0']]){
  const r=await execute('c',{rubricId:'r',rubricVersion:'1',criterionScores:[{criterionId:'v',score:2,evidenceIds:ids}]},undefined,()=>1);
  expect(r.status).toBe('ok');expect(r.data?.dimensions[0]?.evidenceIds).toEqual(['e1']);expect(r.data?.normalizedScore).toBe(.5);
 }
});
