import{test,expect}from'bun:test';import{mkdtempSync,readdirSync,unlinkSync,rmdirSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{createFieldSession}from'../apps/agent/src/field/session.ts';import{scoreFieldSession}from'../apps/agent/src/field/score.ts';import example from'../apps/agent/src/model-access/qianwen.example.json'with{type:'json'};
test('field scoring runs real SDK over injected HTTP, persists results and replays without key or network',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'field-scoring-')),s=createFieldSession(join(dir,'study.sqlite'),{participantId:'test-only',consentRecordId:'test-consent',consentedAt:Date.now(),developmentReviewerIds:[]});
 const config={...example,authorization:{enabled:true,operatorApproved:true,maxRuns:16,expiresAt:Date.now()+60000}};let calls=0;
 try{for(const role of ['java-backend','web-frontend']as const)s.submit(role,s.questions(role)[0]!.id,role==='java-backend'?'先明确并发不变量，再设计原子操作与监控。':'先明确状态更新顺序，再用请求序号排除过期回调。');
 const r=await scoreFieldSession(s,config,{readCredential:()=> 'injected-project-fixture',fetch:async(input,init)=>{calls++;const request=input instanceof Request?input:new Request(input,init),body=await request.json()as any;
 const message=body.messages.filter((m:any)=>m.role==='user').at(-1).content;const text=typeof message==='string'?message:message.map((p:any)=>p.text??'').join('');const value=JSON.parse(text),answer=value.interview.answer.text;
 const output=JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:answer.slice(0,4)}],criterionScores:value.rubric.criteria.map((c:any)=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:[],improvements:['纯离线测试，不作为真人评分结果']}});
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:output},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
 expect(r.outcomes.map(x=>x.status)).toEqual(['completed','completed']);expect(r.liveModelCalls).toBe(0);expect(calls).toBe(2);
 const replay=await scoreFieldSession(s,config,{readCredential:()=>{throw Error('no key');},fetch:async()=>{throw Error('no HTTP');}});expect(replay.httpAttemptsThisInvocation).toBe(0);expect(s.status().modelResults).toBe(2);
 expect(s.reviewReport('java-backend',[]).nonLiveModelCases).toHaveLength(1);
 }finally{s.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
},30000);
