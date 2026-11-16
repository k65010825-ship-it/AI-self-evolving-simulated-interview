import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {createPilotStack} from '../apps/pilot/stack.ts';import {PilotConfigSchema} from '../apps/pilot/config.ts';
import model from '../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
// Explicit local acceptance only. No human audio, default config mutation or automatic retry.
if(process.argv[2]!=='--execute')throw Error('Explicit --execute required: at most 10 provider HTTP attempts / CNY2 declared hold');
const dir=resolve('.cache/pilot-live',randomUUID());mkdirSync(dir,{recursive:true});
const usersFile=join(dir,'users.json');writeFileSync(usersFile,JSON.stringify([{userId:'smoke-student',name:'合成验收',password:'smoke-local-fixture-password'}]));
const expiresAt=Date.now()+600000;
const config=PilotConfigSchema.parse({version:1,mode:'live',stateDir:dir,usersFile,internalToken:randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),apiPort:0,agentPort:0,
 allowDraftKnowledge:true,expressionEnabled:true,budget:{maxCostMicros:2000000,maxCalls:10,maxConcurrent:2},model:{...model,
  authorization:{enabled:true,operatorApproved:true,expiresAt,maxRuns:5},outputRepair:'json-fence-only',evidenceGrounding:'unique-excerpt',questionDelivery:'natural-bridge',
  recovery:{httpMaxAttempts:1,maxModelRepairs:0,baseDelayMs:250,maxDelayMs:3000},
  profile:{...model.profile,limits:{...model.profile.limits,maxCalls:8,maxOutputTokens:2000,maxCostMicros:1600000,maxInputCharacters:100000}}}});
const http:{model:string;status:number|null}[]=[];const originalFetch=globalThis.fetch;
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(input instanceof Request?input.url:input.toString());
 if(['localhost','127.0.0.1'].includes(url.hostname))return originalFetch(input,init);
 if(!['maas.qianwenaiapi.com','cn-beijing.maas.qianwenaiapi.com'].includes(url.hostname)||http.length>=10||Date.now()>=expiresAt)throw Error('SMOKE_NETWORK_LIMIT');
 let modelId='unknown';try{modelId=JSON.parse(typeof init?.body==='string'?init.body:'{}').model??'unknown';}catch{}
 const row={model:modelId,status:null as number|null};http.push(row);
 const response=await originalFetch(input,init);row.status=response.status;return response;
}) as typeof fetch;
const stack=await createPilotStack(config);let token='',sessionId='';const steps:Record<string,unknown>={};
async function call(path:string,body?:unknown,method=body?'POST':'GET'){
 const response=await fetch(stack.apiUrl+path,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(body?{'content-type':body instanceof Uint8Array?'audio/wav':'application/json'}:{})},
 ...(body?{body:body instanceof Uint8Array?new Uint8Array(body).buffer:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(65000)});
 if(!response.ok){const problem=await response.json() as {code?:string};throw Error(problem.code??`HTTP_${response.status}`);}return response;
}
async function operation(id:string,path:string,body:Record<string,unknown>){await call(path,{operationId:id,...body});await stack.api.service.wait(id);
 const op=await(await call(`/v1/operations/${id}`)).json() as {status:string;errorCode:string|null};if(op.status!=='completed')throw Error(op.errorCode??op.status);}
try{
 token=((await(await call('/v1/auth/login',{userId:'smoke-student',password:'smoke-local-fixture-password'})).json()) as any).token;
 const created=await(await call('/v1/interviews',{operationId:'create',roleId:'java-backend',goal:'验证事务场景与语音链路',durationMinutes:15})).json() as any;
 sessionId=created.sessionId;await stack.api.service.wait('create');let view=await(await call(`/v1/interviews/${sessionId}`)).json() as any;
 await operation('plan',`/v1/interviews/${sessionId}/question`,{expectedRevision:view.revision});view=await(await call(`/v1/interviews/${sessionId}`)).json() as any;steps.planning='completed';
 try{const bytes=await(await call(`/v1/interviews/${sessionId}/question-audio?questionId=${encodeURIComponent(view.question.id)}`)).arrayBuffer();writeFileSync(join(dir,'question.wav'),Buffer.from(bytes));steps.tts={status:'completed',bytes:bytes.byteLength};}catch(e){steps.tts={status:'failed',code:(e as Error).message};}
 const wav=new Uint8Array(readFileSync('.cache/asr-live/local-synthesized-en.wav'));
 const registered=await(await call(`/v1/interviews/${sessionId}/speech`,{expectedRevision:view.revision,sha256:createHash('sha256').update(wav).digest('hex'),byteLength:wav.length})).json() as any;
 await call(`/v1/speech/${registered.speechId}/audio`,wav,'PUT');await stack.agent.speech.wait(registered.speechId);
 const ready=await(await call(`/v1/speech/${registered.speechId}`)).json() as any;
 steps.asr={status:ready.status,errorCode:ready.errorCode,originalText:ready.originalText,expression:ready.expression};
 if(!ready.originalText)throw Error(ready.errorCode??'ASR_EMPTY');
 const confirmed=await(await call(`/v1/speech/${registered.speechId}/confirmation`,{expectedVersion:ready.version,text:ready.originalText})).json() as any;
 await operation('answer',`/v1/interviews/${sessionId}/answers`,{expectedRevision:view.revision,text:confirmed.confirmedText,speechId:registered.speechId});
 view=await(await call(`/v1/interviews/${sessionId}`)).json() as any;steps.answer={scored:view.scoredCount,unscored:view.unscoredCount,clarification:!!view.clarification};
 await operation('finish',`/v1/interviews/${sessionId}/completion`,{expectedRevision:view.revision});steps.report=await(await call(`/v1/interviews/${sessionId}`)).json();
}catch(e){steps.error=(e as Error).message;}finally{
 const report={createdAt:Date.now(),steps,http,httpAttempts:http.length,limit:10,budgetMicros:2000000,
  accounting:sessionId?stack.agent.ledger.snapshot(sessionId):null,humanAudio:false,qualityValidated:false,vendorBillingVerified:false,authorizationClosed:true};
 writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));await stack.close();globalThis.fetch=originalFetch;
 console.log(JSON.stringify({artifact:join(dir,'report.json'),httpAttempts:http.length,steps:Object.keys(steps),error:steps.error??null,paidQualityClaims:false}));
}
