import {expect,test} from 'bun:test';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';import cfg from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import {contentText} from '../experiments/pi-sdk/planner-fixture.ts';
const secret='synthetic-private-key-do-not-store';
function stream(delta:unknown,reason='stop'){return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:reason}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
test('local live session has fixed mode, requires grant and uses injected HTTP with persistent cross-command accounting',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-live-'));let calls=0,keys=0;const config={...cfg,profile:{...cfg.profile,limits:{...cfg.profile.limits,maxCalls:6,maxTotalTokens:100000,maxCostMicros:1000000}},planning:'pi-knowledge',questionDelivery:'canonical'};
 const host=await createLocalHost({dataDir:root,assetsRoot:process.cwd(),resolveCredential:async()=>{keys++;return secret;},liveFetch:async(input,init)=>{
  calls++;const req=new Request(input,init);expect(req.headers.get('authorization')).toBe('Bearer '+secret);const body=await req.json()as any,tool=body.messages.find((m:any)=>m.role==='tool');
  if(tool){const receipt=JSON.parse(contentText(tool.content));return stream({content:JSON.stringify({questionId:receipt.data.items[0].id})});}
  const p=JSON.parse(contentText(body.messages.find((m:any)=>m.role==='user').content));if(p.rubric){const text=p.interview.answer.text;return stream({content:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],criterionScores:p.rubric.criteria.map((c:any)=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:['合成反馈'],improvements:['待审核']}})});}
  return stream({tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
 }});
 try{const c=host.command('session.create',{operationId:'live-create',roleId:'java-backend',goal:'本地live注入验收',durationMinutes:20,mode:'live',liveConfig:config,sessionBudget:{maxCalls:6,maxTotalTokens:100000,maxCostMicros:1000000}});await host.wait(c.jobId);expect(calls).toBe(0);expect(keys).toBe(0);
  expect(()=>host.command('session.nextQuestion',{sessionId:c.sessionId,operationId:'no-grant',expectedRevision:0})).toThrow();
  host.authorize({grantId:'g1',sessionId:c.sessionId,expectedVersion:0,expiresAt:Date.now()+60000,credentialRef:'model-key',profile:config.profile});
  const p=host.command('session.nextQuestion',{sessionId:c.sessionId,operationId:'plan',expectedRevision:0});await host.wait(p.jobId);expect(host.job(p.jobId)).toMatchObject({status:'completed'});
  const a=host.command('session.answer',{sessionId:c.sessionId,operationId:'answer',expectedRevision:1,text:'我会明确事务边界并核验回滚路径。'});await host.wait(a.jobId);expect(host.job(a.jobId)).toMatchObject({status:'completed'});expect(calls).toBe(3);expect(host.liveTotals(c.sessionId).callsConsumed).toBe(3);
  expect(host.session(c.sessionId).mode).toBe('live');await host.close();const bytes=await readFile(join(root,'agent','profiles','default','profile.sqlite'));expect(bytes.includes(Buffer.from(secret))).toBe(false);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},30000);
