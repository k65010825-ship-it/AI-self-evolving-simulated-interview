import {test,expect} from 'bun:test';import {mkdtempSync,writeFileSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createPilotStack} from '../apps/pilot/stack.ts';import {PilotConfigSchema} from '../apps/pilot/config.ts';import model from '../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
test('real API-Agent TCP stack owns login, voice upload, confirmation, question audio, report and restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pilot-stack-')),usersFile=join(dir,'users.json');writeFileSync(usersFile,JSON.stringify([{userId:'student',name:'Test Student',password:'fixture-student-password'}]));
 const config=PilotConfigSchema.parse({version:1,mode:'offline-fixture',stateDir:dir,usersFile,internalToken:'pilot-stack-fixture-token-0000000000000',apiPort:0,agentPort:0,allowDraftKnowledge:true,expressionEnabled:false,model,budget:{maxCostMicros:2000000,maxCalls:40,maxConcurrent:2}});
 let stack=await createPilotStack(config,{readCredential:()=>{throw Error('offline must not read provider key');}}),token='';
 const call=async(path:string,body?:unknown,method=body?'POST':'GET')=>{const response=await fetch(stack.apiUrl+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(body?{'content-type':body instanceof Uint8Array?'audio/wav':'application/json'}:{})},
  ...(body?{body:body instanceof Uint8Array?new Uint8Array(body).buffer:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});expect(response.ok).toBe(true);return response;};
 try{const login=await(await call('/v1/auth/login',{userId:'student',password:'fixture-student-password'})).json() as any;token=login.token;
  const accepted=await(await call('/v1/interviews',{operationId:'create',roleId:'java-backend',goal:'全链路语音练习',durationMinutes:20})).json() as any;const sid=accepted.sessionId;await stack.api.service.wait('create');
  let view=await(await call(`/v1/interviews/${sid}`)).json() as any;
  await call(`/v1/interviews/${sid}/question`,{operationId:'plan',expectedRevision:view.revision});await stack.api.service.wait('plan');view=await(await call(`/v1/interviews/${sid}`)).json() as any;
  const audio=await(await call(`/v1/interviews/${sid}/question-audio?questionId=${encodeURIComponent(view.question.id)}`)).arrayBuffer();expect(Buffer.from(audio).subarray(0,4).toString()).toBe('RIFF');
  const wav=makeSpeechFixture().wavBytes,registered=await(await call(`/v1/interviews/${sid}/speech`,{expectedRevision:view.revision,sha256:createHash('sha256').update(wav).digest('hex'),byteLength:wav.length})).json() as any;
  await call(`/v1/speech/${registered.speechId}/audio`,wav,'PUT');await stack.agent.speech.wait(registered.speechId);
  const ready=await(await call(`/v1/speech/${registered.speechId}`)).json() as any;expect(ready.originalText).toContain('离线示例');
  const confirmed=await(await call(`/v1/speech/${registered.speechId}/confirmation`,{expectedVersion:ready.version,text:ready.originalText+'。'})).json() as any;
  await call(`/v1/interviews/${sid}/answers`,{operationId:'answer',expectedRevision:view.revision,text:confirmed.confirmedText,speechId:registered.speechId});await stack.api.service.wait('answer');view=await(await call(`/v1/interviews/${sid}`)).json() as any;expect(view.scoredCount).toBe(1);
  await call(`/v1/interviews/${sid}/completion`,{operationId:'finish',expectedRevision:view.revision});await stack.api.service.wait('finish');const done=await(await call(`/v1/interviews/${sid}`)).json() as any;expect(done.phase).toBe('completed');expect(done.report.expression.status).toBe('audio_descriptions');
  await stack.close();stack=await createPilotStack(config,{readCredential:()=>{throw Error('must not read');}});expect(await(await call(`/v1/interviews/${sid}`)).json()).toEqual(done);
 }finally{await stack.close();for(const name of readdirSync(dir))unlinkSync(join(dir,name));rmdirSync(dir);}
},30000);
