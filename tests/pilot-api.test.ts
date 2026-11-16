import {test,expect} from 'bun:test';import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createPilotService} from '../apps/api/src/pilot/service.ts';import {createApiApp} from '../apps/api/src/app.ts';
import {createOfflineRunManager} from '../apps/agent/src/runtime/offline-runtime.ts';
test('API owns authenticated workflows, commits once, redacts rubric and restores formal report/memory',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pilot-api-')),runtime=await createOfflineRunManager({planning:'pi-knowledge'});let calls=0;const diagnostics:unknown[]=[];
 const options={path:join(dir,'pilot.sqlite'),users:[{userId:'alice',name:'Alice',password:'fixture-password-alice'},{userId:'bob',name:'Bob',password:'fixture-password-bob'}],
  evidenceMode:'offline-fixture' as const,allowDraftKnowledge:true,onDiagnostic:(e:unknown)=>{diagnostics.push(e);},run:async(request:any)=>{calls++;runtime.start(request);await runtime.wait(request.context.runId);return runtime.snapshot(request.context.runId);}};
 let service=createPilotService(options),app=createApiApp('api',{pilot:service});
 async function login(userId='alice'){const r=await app.request('/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,password:`fixture-password-${userId}`})});expect(r.status).toBe(200);return (await r.json() as {token:string}).token;}
 async function call(path:string,token:string,body?:unknown){return app.request(path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
 try{expect((await app.request('/v1/interviews')).status).toBe(401);const token=await login(),bob=await login('bob');
  const create={operationId:'create-1',roleId:'java-backend',goal:'练习事务与项目说明',durationMinutes:20};
  const r=await call('/v1/interviews',token,create);expect(r.status).toBe(202);const start=await r.json() as {sessionId:string;operationId:string};await service.wait(start.operationId);expect(diagnostics).toEqual([]);expect(service.getOperation('alice','create-1')).toMatchObject({status:'completed'});
  expect((await call(`/v1/interviews/${start.sessionId}`,bob)).status).toBe(403);
  await call('/v1/interviews',token,create);expect(calls).toBe(1);
  let view=await (await call(`/v1/interviews/${start.sessionId}`,token)).json() as any;
  expect((await call(`/v1/interviews/${start.sessionId}/question`,token,{operationId:'plan-1',expectedRevision:view.revision})).status).toBe(202);await service.wait('plan-1');expect(service.getOperation('alice','plan-1')).toMatchObject({status:'completed'});
  view=await (await call(`/v1/interviews/${start.sessionId}`,token)).json();expect(view.question.text.length).toBeGreaterThan(0);
  expect(JSON.stringify(view)).not.toContain('keyPoints');expect(JSON.stringify(view)).not.toContain('rubric');
  await call(`/v1/interviews/${start.sessionId}/answers`,token,{operationId:'answer-1',expectedRevision:view.revision,text:'先明确事务边界，再通过补偿任务保证失败后的幂等恢复。'});await service.wait('answer-1');
  view=await (await call(`/v1/interviews/${start.sessionId}`,token)).json();expect(view.scoredCount).toBe(1);
  await call(`/v1/interviews/${start.sessionId}/completion`,token,{operationId:'finish-1',expectedRevision:view.revision});await service.wait('finish-1');
  const finished=await (await call(`/v1/interviews/${start.sessionId}`,token)).json() as any;expect(finished.phase).toBe('completed');expect(finished.report.coverage.scoredAnswers).toBe(1);
  service.close();service=createPilotService(options);app=createApiApp('api',{pilot:service});
  expect(await (await call(`/v1/interviews/${start.sessionId}`,token)).json()).toEqual(finished);
  expect(service.memoryFor('alice','java-backend').sessions).toHaveLength(1);
 }finally{service.close();runtime.dispose();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
},20000);
test('create admission failure cannot leave an orphan session or bypass same-operation idempotency',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pilot-admit-')),runtime=await createOfflineRunManager();let allowed=false,calls=0;
 const s=createPilotService({path:join(dir,'pilot.sqlite'),users:[{userId:'alice',name:'Alice',password:'fixture-password-alice'}],evidenceMode:'offline-fixture',allowDraftKnowledge:true,
  onSession:()=>{if(!allowed)throw Error('injected admission failure');},run:async r=>{calls++;runtime.start(r);await runtime.wait(r.context.runId);return runtime.snapshot(r.context.runId);}});
 try{const input={operationId:'one-create',roleId:'java-backend',goal:'test',durationMinutes:20};expect(()=>s.createSession('alice',input)).toThrow();expect(calls).toBe(0);
  allowed=true;const accepted=s.createSession('alice',input);await s.wait(accepted.operationId);expect(s.listSessions('alice')).toHaveLength(1);
 }finally{s.close();runtime.dispose();for(const f of readdirSync(dir))unlinkSync(join(dir,f));rmdirSync(dir);}
});
