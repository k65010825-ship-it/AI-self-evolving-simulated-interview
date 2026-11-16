import {expect,test} from 'bun:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {LocalEventSchema} from '../packages/contracts/src/local-runtime.ts';
import cfg from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import {contentText} from '../experiments/pi-sdk/planner-fixture.ts';
const secret='synthetic-diagnostic-private';
const privateText='PRIVATE_GENERATION_MUST_NOT_PERSIST_IN_DIAGNOSTICS';
const limits={maxCalls:6,maxTotalTokens:100000,maxCostMicros:1000000};
const config={...cfg,profile:{...cfg.profile,limits:{...cfg.profile.limits,...limits}},planning:'pi-knowledge',questionDelivery:'canonical',evidenceGrounding:'quoted-spans',outputRepair:'json-fence-only'};
function stream(delta:unknown,reason='stop'){return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:reason}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
for(const fault of ['json','schema','evidence','binding']as const)test('local '+fault+' rejection survives restart as sanitized diagnostics and corrected fixture passes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-diagnostic-'));let calls=0,corrected=false;
 const fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{calls++;const body=await new Request(input,init).json()as any;
  const tool=body.messages.find((m:any)=>m.role==='tool');if(tool){const receipt=JSON.parse(contentText(tool.content));return stream({content:JSON.stringify({questionId:receipt.data.items[0].id})});}
  const p=JSON.parse(contentText(body.messages.find((m:any)=>m.role==='user').content));
  if(!p.rubric)return stream({tool_calls:[{index:0,id:'k',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
  const output:any={evidence:[{id:'e',excerpt:p.interview.answer.text}],criterionScores:p.rubric.criteria.map((c:any)=>({criterionId:c.id,score:0,evidenceIds:['e']})),feedback:{strengths:[],improvements:['合成协议验证']}};
  if(!corrected){if(fault==='json')return stream({content:'{"'+privateText+'":'});if(fault==='schema')output.criterionScores[0].score=privateText;
   else if(fault==='evidence')output.evidence[0].excerpt=privateText;
   else output.criterionScores[0].verificationBinding={goalId:'unrequested-goal',goalVersion:'1',mode:'proposed',action:{evidenceId:'e',excerpt:'明确'},target:{evidenceId:'e',excerpt:'事务边界'},expectation:{evidenceId:'e',excerpt:'异常回滚条件'}};
  }
  return stream({content:JSON.stringify(output)});
 };
 let host=await createLocalHost({dataDir:root,assetsRoot:process.cwd(),resolveCredential:async()=>secret,liveFetch:fetch});
 try{
  const c=host.command('session.create',{operationId:'create',roleId:'java-backend',goal:'合成拒绝分支',durationMinutes:20,mode:'live',liveConfig:config,sessionBudget:limits});await host.wait(c.jobId);
  host.authorize({grantId:'g',sessionId:c.sessionId,expectedVersion:0,expiresAt:Date.now()+120000,credentialRef:'key',profile:config.profile});
  const p=host.command('session.nextQuestion',{operationId:'plan',sessionId:c.sessionId,expectedRevision:0});await host.wait(p.jobId);expect(host.job(p.jobId).status).toBe('completed');
  const answer={sessionId:c.sessionId,expectedRevision:1,text:'合成回答：明确事务边界与异常回滚条件。'};
  const failed=host.command('session.answer',{...answer,operationId:'bad'});await host.wait(failed.jobId);
  expect(host.job(failed.jobId)).toMatchObject({status:'failed',errorCode:'MODEL_OUTPUT_INVALID'});
  const events=host.events(failed.jobId),diagnostics=events.flatMap(e=>(e as any).diagnostic?[(e as any).diagnostic]:[]);
  expect(diagnostics.some(d=>d.stage===(fault==='binding'?'scoring':fault)&&d.outcome==='rejected')).toBe(true);
  if(fault==='binding')expect(diagnostics).toContainEqual(expect.objectContaining({stage:'scoring',reason:'score-binding-invalid',bindingIssue:'unexpected-binding'}));
  if(fault==='schema')expect(diagnostics).toContainEqual(expect.objectContaining({schemaIssue:{field:'criterionScores.score',issue:'invalid_type',receivedType:'string'}}));
  for(const event of events)expect(LocalEventSchema.safeParse(event).success).toBe(true);
  expect(JSON.stringify(events)).not.toContain(privateText);expect(JSON.stringify(events)).not.toContain(secret);
  expect(host.session(c.sessionId)).toMatchObject({revision:1,answeredCount:0});expect(calls).toBe(3);
  const totals=host.liveTotals(c.sessionId);await host.close();
  host=await createLocalHost({dataDir:root,assetsRoot:process.cwd(),resolveCredential:async()=>secret,liveFetch:fetch});
  expect(host.events(failed.jobId)).toEqual(events);expect(host.liveTotals(c.sessionId)).toEqual(totals);expect(calls).toBe(3);
  corrected=true;host.authorize({grantId:'g2',sessionId:c.sessionId,expectedVersion:1,expiresAt:Date.now()+120000,credentialRef:'key',profile:config.profile});
  const good=host.command('session.answer',{...answer,operationId:'corrected'});await host.wait(good.jobId);
  expect(host.job(good.jobId).status).toBe('completed');expect(host.session(c.sessionId)).toMatchObject({revision:2,answeredCount:1});expect(calls).toBe(4);
  expect(host.events(failed.jobId)).toEqual(events);
  await host.close();expect((await readFile(join(root,'agent','profiles','default','profile.sqlite'))).includes(Buffer.from(secret))).toBe(false);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},30000);

test('local event diagnostic rejects arbitrary text, paths and unknown model fields',()=>{
 const base={jobId:'j',seq:1,status:'running',stage:'schema'};
 const diagnostic={version:1,stage:'schema',outcome:'rejected',reason:'invalid-schema',schemaIssue:{field:'criterionScores.score',issue:'invalid_type',receivedType:'string'}};
 expect(LocalEventSchema.safeParse({...base,diagnostic}).success).toBe(true);
 for(const unsafe of [{...diagnostic,message:secret},{...diagnostic,schemaIssue:{...diagnostic.schemaIssue,field:privateText}},{...diagnostic,reason:privateText}])expect(LocalEventSchema.safeParse({...base,diagnostic:unsafe}).success).toBe(false);
});
