import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';

test('quote part and match details persist in batch JSON/Markdown and survive replay without raw quote text',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,evidenceGrounding:'quoted-spans',authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const r=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:async(input,init)=>{
  calls++;const raw=await(input instanceof Request?input:new Request(input,init)).json()as {messages:{role:string;content:string|{text?:string}[]}[]};
  const content=raw.messages.filter(m=>m.role==='user').at(-1)!.content;
  const payload=JSON.parse(typeof content==='string'?content:content.map(c=>c.text??'').join(''))as {interview:{answer:{text:string}};rubric:{criteria:{id:string;verificationGoal?:{id:string;version:string}}[]}};
  const ref={evidenceId:'unit',excerpt:'private-never-in-answer'};
  const output={evidence:[{id:'unit',excerpt:payload.interview.answer.text}],criterionScores:payload.rubric.criteria.map(c=>({criterionId:c.id,score:c.verificationGoal?0:null,evidenceIds:c.verificationGoal?['unit']:[],
   ...(c.verificationGoal?{verificationBinding:{goalId:c.verificationGoal.id,goalVersion:c.verificationGoal.version,mode:'proposed',action:ref,target:ref,expectation:ref}}:{})})),feedback:{strengths:[],improvements:['仅离线机制夹具']}};
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }});
 expect(calls).toBe(4);expect(r.rows.every(row=>row.diagnostics.some(d=>d.quoteIssue?.part==='action'&&d.quoteIssue.matches==='none'))).toBe(true);
 expect(r.rows.every(row=>row.diagnostics.some(d=>d.stage==='schema'&&d.outcome==='accepted'))).toBe(true);
 const markdown=await readFile(join(p.output,'report.md'),'utf8');expect(markdown).toContain('"part":"action"');expect(markdown).not.toContain('private-never-in-answer');expect(JSON.stringify(r)).not.toContain('private-never-in-answer');
 const again=await executeQualityBatch(p.output,config,{readCredential:()=>{throw Error();},fetch:async()=>{throw Error();}});
 expect(again.rows.map(row=>row.diagnostics)).toEqual(r.rows.map(row=>row.diagnostics));expect(calls).toBe(4);
},30000);
