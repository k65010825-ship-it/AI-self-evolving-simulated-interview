import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api,Model,AssistantMessage,CredentialStore } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { stream as streamCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import type { LiveServiceConfig } from '../../../../packages/contracts/src/live-model.ts';
import type { ModelBudgetGate } from './budget.ts';
import { meterSseBody } from './usage-meter.ts';
import{retryDelay,waitForRecovery,recoveryEvent,ensureModelAttemptBudget,type RecoverySleep}from'./recovery.ts';
import type{ModelRecoverySink}from'../../../../packages/contracts/src/model-recovery.ts';
import{prepareWireContext,type WirePayload,type WireCompactor}from'../context/wire-context.ts';
import{contextErrorCode,inspectCompletion,completionResponse}from'./wire-response.ts';
import type{ModelAccessProfile}from'../../../../packages/contracts/src/model-access.ts';
import type{ModelBudgetSnapshotSchema}from'../../../../packages/contracts/src/model-access.ts';
import type{AgentRunSnapshot,AgentRunEvent}from'../../../../packages/contracts/src/agent-run.ts';
import type{z}from'zod';
import type{ToolContext}from'../../../../packages/contracts/src/tools.ts';
import {WireCompletionSchema,type WireCompletion} from '../../../../packages/contracts/src/wire-completion.ts';
import type {EvaluationDiagnostic} from '../../../../packages/contracts/src/evaluation-diagnostic.ts';

export type LiveFetch=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export interface LiveModelDependencies{readCredential:(name:string)=>string|undefined;fetch?:LiveFetch;now?:()=>number;canDispatch?:()=>boolean;
 assetsRoot?:string;
 onCompletion?:(detail:WireCompletion)=>void;
 onEvaluationDiagnostic?:(context:ToolContext,event:EvaluationDiagnostic)=>void;
 previewEditorsFor?:(context:ToolContext)=>readonly string[];
 wireCompactors?:readonly WireCompactor[];
 recoverySleep?:RecoverySleep;random?:()=>number;onRecovery?:ModelRecoverySink;
 onRunCheckpoint?:(snapshot:AgentRunSnapshot,event:AgentRunEvent)=>void;
 onBudgetCheckpoint?:(context:ToolContext,snapshot:z.infer<typeof ModelBudgetSnapshotSchema>,profile:ModelAccessProfile)=>void;
 canDispatchRun?:(context:ToolContext)=>boolean;hasBlockedAccounting?:()=>boolean;}
export function assertLiveAuthorized(c:LiveServiceConfig,now:number){
 if(!c.authorization.enabled||!c.authorization.operatorApproved||!Number.isSafeInteger(now)||now>=c.authorization.expiresAt)throw Error('LIVE_SERVICE_NOT_AUTHORIZED');
}
/** Public Pi API only; all HTTP goes through one explicit, non-redirecting, budgeted boundary. */
export async function createBailianPiRuntime(c:LiveServiceConfig,gate:ModelBudgetGate,deps:LiveModelDependencies,output:{responseFormat?:'json_object';onDiagnostic?:(event:EvaluationDiagnostic)=>void}={}){
 const clock=deps.now??Date.now,transport=deps.fetch??globalThis.fetch;
 assertLiveAuthorized(c,clock());
 const credentials:CredentialStore={read:async()=>undefined,list:async()=>[],modify:async()=>{throw Error('LIVE_CREDENTIAL_WRITE_DISABLED');},delete:async()=>{}};
 const runtime=await ModelRuntime.create({credentials,modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 let sequence=0;
 runtime.registerProvider('interview-bailian',{api:'openai-completions',apiKey:'explicit-host-credential-required',baseUrl:c.profile.endpoint,
  models:[{id:c.profile.modelId,name:'Host-configured Bailian',api:'openai-completions',reasoning:false,input:['text'],contextWindow:131072,maxTokens:c.profile.limits.maxOutputTokens,
   cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsStore:false,supportsDeveloperRole:false,supportsUsageInStreaming:true,supportsReasoningEffort:false,maxTokensField:'max_tokens'}}],
  streamSimple:(model,context,options)=>{
   const out=createAssistantMessageEventStream(),controller=new AbortController();
   const signal=options?.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
   const attempts:{id:string;meter?:ReturnType<typeof meterSseBody>}[]=[];
   let completionReported=false,hostContinuation=false;
   const reportCompletion=(sdkStop:WireCompletion['sdkStop'],text?:string)=>{
    const meter=attempts.at(-1)?.meter;if(completionReported||!meter||signal.aborted)return;completionReported=true;
    try{const detail=WireCompletionSchema.parse({...meter.completion(hostContinuation?undefined:text),sdkStop,
     comparisonScope:hostContinuation?'host-continuation-not-compared':'upstream-to-sdk'});
     const result:unknown=deps.onCompletion?.(detail);if(result&&typeof(result as {then?:unknown}).then==='function')void Promise.resolve(result).catch(()=>{});
    }catch{/* Fixed diagnostics cannot change generation or billing. */}
   };
   const callDeadline=Math.min(clock()+c.profile.limits.timeoutMs,gate.snapshot().scope.deadlineAt,c.authorization.expiresAt);
   const remaining=callDeadline-clock();
   const timer=setTimeout(()=>controller.abort(),Math.max(1,remaining));
   const failure=():AssistantMessage=>({role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:[],stopReason:signal.aborted?'aborted':'error',
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},errorMessage:'LIVE_MODEL_CALL_FAILED'});
   const unknown=()=>{for(const a of attempts){try{if(gate.snapshot().entries.find(e=>e.callId===a.id)?.status==='dispatched')gate.markUnknown(a.id);}catch{/* retain conservative holds */}}};
   let closed=false;
   const onStop=()=>{if(closed)return;closed=true;unknown();const e=failure();out.push({type:'error',reason:'aborted',error:e});out.end();};
   signal.addEventListener('abort',onStop,{once:true});
   void(async()=>{
    try{
     assertLiveAuthorized(c,clock());if(signal.aborted||remaining<=0||deps.canDispatch?.()===false)throw Error('stopped');
     const secret=deps.readCredential(c.profile.credentialSource.name);
     if(typeof secret!=='string'||secret.length<1||secret.length>4096||/[\r\n]/.test(secret))throw Error('credential');
     const guardedFetch:LiveFetch=async(input,init)=>{
      assertLiveAuthorized(c,clock());if(signal.aborted||deps.canDispatch?.()===false)throw Error('stopped');
      const request=new Request(input,init);
      if(request.url!==c.profile.endpoint+'/chat/completions'||request.method!=='POST'||request.headers.get('authorization')!==`Bearer ${secret}`)throw Error('request');
      const body=await request.clone().text();if(body.length>c.profile.limits.maxInputCharacters)throw Error('input');
      let payload=JSON.parse(body)as WirePayload;
      let outputCap=c.recovery.initialOutputTokens??c.profile.limits.maxOutputTokens,outputRecoveries=0,contextCompactions=0,prefix='';
      if(payload.model!==c.profile.modelId||payload.stream!==true||payload.max_tokens!==outputCap||payload.enable_thinking!==false||!Array.isArray(payload.messages))throw Error('payload');
      if(output.responseFormat==='json_object'){
       if(JSON.stringify(payload.response_format)!=='{"type":"json_object"}'||(Array.isArray(payload.tools)&&payload.tools.length>0)||payload.tool_choice!==undefined)throw Error('evaluation payload');
      }else if(payload.response_format!==undefined)throw Error('unexpected response format');
      const prepared=prepareWireContext(payload,c.recovery.autoCompact,outputCap,false,deps.wireCompactors);payload=prepared.payload;
      if(prepared.compacted)recoveryEvent(deps.onRecovery,'http','compact-applied','auto-threshold',1);
      for(let httpAttempt=1;;){
      payload={...payload,max_tokens:outputCap};
      const fitted=prepareWireContext(payload,c.recovery.autoCompact,outputCap,false,deps.wireCompactors);payload=fitted.payload;
      if(fitted.compacted)recoveryEvent(deps.onRecovery,'http','compact-applied','auto-threshold',1);
      // No await between this final process-wide authorization check and transport dispatch.
      assertLiveAuthorized(c,clock());if(signal.aborted||deps.canDispatch?.()===false)throw Error('stopped');
      const nextBody=JSON.stringify({...payload,max_tokens:outputCap});if(nextBody.length>c.profile.limits.maxInputCharacters)throw Error('input');
      const id=`${output.responseFormat?'evaluation-':''}http-${++sequence}`;gate.reserve(id,{inputTokens:c.profile.limits.maxInputTokens,outputTokens:outputCap});
      const attempt:{id:string;meter?:ReturnType<typeof meterSseBody>}={id};attempts.push(attempt);
      try{
       if(signal.aborted){gate.release(id);throw Error('stopped');}gate.dispatch(id);
       if(output.responseFormat)try{output.onDiagnostic?.({version:1,stage:'transport',outcome:'observed',reason:'json-mode-requested'});}catch{/* telemetry only */}
       let onAbort:(()=>void)|undefined;
       const pending=transport(new Request(request.url,{method:'POST',headers:request.headers,body:nextBody,redirect:'error',signal}));
       void pending.then(r=>{if(signal.aborted)void r.body?.cancel().catch(()=>{});},()=>{});
       let response:Response;
       try{response=await Promise.race([pending,new Promise<never>((_r,reject)=>{
        onAbort=()=>reject(Error('stopped'));signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();
       })]);}finally{if(onAbort)signal.removeEventListener('abort',onAbort);}
       if(signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('stopped');}
       if(output.responseFormat&&response.status===400){
        void response.body?.cancel().catch(()=>{});gate.rejectHttp(id,400);
        try{output.onDiagnostic?.({version:1,stage:'transport',outcome:'rejected',reason:'json-mode-http-rejected'});}catch{/* telemetry only */}
        throw Error('JSON_MODE_HTTP_REJECTED');
       }
       if(c.recovery.httpMaxAttempts>1&&(response.status===429||response.status===503)){
        const status=response.status,retryAfter=response.headers.get('retry-after');void response.body?.cancel().catch(()=>{});
        gate.rejectHttp(id,status);
        if(httpAttempt>=c.recovery.httpMaxAttempts){recoveryEvent(deps.onRecovery,'http','stopped','attempt-limit',httpAttempt);throw Error('limit');}
        const delay=retryDelay(retryAfter,httpAttempt,c.recovery,clock(),deps.random);
        if(delay===null){recoveryEvent(deps.onRecovery,'http','stopped','retry-after-limit',httpAttempt);throw Error('retry after');}
        try{ensureModelAttemptBudget(gate);}catch{recoveryEvent(deps.onRecovery,'http','stopped','budget',httpAttempt);throw Error('budget');}
        recoveryEvent(deps.onRecovery,'http','retry-scheduled',status===429?'http-429':'http-503',httpAttempt,delay);
        await waitForRecovery(delay,{signal,deadlineAt:callDeadline,now:clock,
         ...(deps.recoverySleep?{sleep:deps.recoverySleep}:{})});
        httpAttempt++;continue;
       }
       if(c.recovery.maxContextCompactions>0&&(response.status===400||response.status===413)&&await contextErrorCode(response,signal)){
        if(signal.aborted||closed)throw Error('stopped');gate.rejectHttp(id,response.status);
        if(contextCompactions>=c.recovery.maxContextCompactions)throw Error('context recovery limit');
        const compacted=prepareWireContext(payload,c.recovery.autoCompact,outputCap,true,deps.wireCompactors);
        if(!compacted.compacted){recoveryEvent(deps.onRecovery,'http','stopped','no-removable-context',1);throw Error('required context');}
        ensureModelAttemptBudget(gate);payload=compacted.payload;contextCompactions++;
        recoveryEvent(deps.onRecovery,'http','compact-applied','context-limit',contextCompactions);httpAttempt=1;continue;
       }
       if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream')){
        void response.body?.cancel().catch(()=>{});throw Error('response');
       }
       attempt.meter=meterSseBody(response.body);
       if(c.recovery.maxOutputRecoveries>0){
        const raw=await new Response(attempt.meter.stream).text();if(signal.aborted||closed||clock()>=callDeadline)throw Error('stopped');
        const usage=attempt.meter.usage();if(!usage)throw Error('usage');if(gate.settle(id,usage).locked)throw Error('overrun');
        const part=inspectCompletion(raw);if(part.output.length+prefix.length>c.profile.limits.maxOutputCharacters)throw Error('output');
        if(part.finish==='length'){
         if(part.tools||c.recovery.truncationMode==='continue'&&!part.output.length||outputRecoveries>=c.recovery.maxOutputRecoveries||c.recovery.truncationMode==='regenerate'&&outputCap>=c.profile.limits.maxOutputTokens)throw Error('length limit');
         ensureModelAttemptBudget(gate);outputRecoveries++;outputCap=c.profile.limits.maxOutputTokens;
         if(c.recovery.truncationMode==='continue'){
          prefix+=part.output;payload={...payload,messages:[...payload.messages,{role:'assistant',content:part.output},
           {role:'user',content:'Continue the unfinished assistant text with the exact remaining characters only. Do not repeat the prefix, add markdown or call tools.'}]};
          delete payload.tools;delete payload.tool_choice;
         }
         recoveryEvent(deps.onRecovery,'http',c.recovery.truncationMode==='continue'?'continue-scheduled':'upgrade-scheduled','output-length',outputRecoveries);httpAttempt=1;continue;
        }
        if(prefix){if(part.tools||part.finish!=='stop')throw Error('continuation invalid');hostContinuation=true;return completionResponse(prefix+part.output,usage);}
        return new Response(raw,{status:response.status,headers:response.headers});
       }
       return new Response(attempt.meter.stream,{status:response.status,headers:response.headers});
      }catch{unknown();throw Error('LIVE_HTTP_FAILED');}
      }
     };
     if(model.api!=='openai-completions')throw Error('api');
     const inner=streamCompletions(model as Model<'openai-completions'>,context,{...options,apiKey:secret,env:{},signal,fetch:Object.assign(guardedFetch,{preconnect:()=>{}}),
      maxTokens:c.recovery.initialOutputTokens??c.profile.limits.maxOutputTokens,maxRetries:0,maxRetryDelayMs:1,timeoutMs:Math.max(1,remaining),
      onPayload:raw=>{
       if(!raw||typeof raw!=='object')throw Error('payload');const p={...raw as Record<string,unknown>};
       delete p.max_completion_tokens;delete p.reasoning_effort;delete p.store;delete p.response_format;
       return{...p,...(output.responseFormat?{response_format:{type:output.responseFormat}}:{}),model:c.profile.modelId,max_tokens:c.recovery.initialOutputTokens??c.profile.limits.maxOutputTokens,stream:true,stream_options:{include_usage:true},enable_thinking:false};
      },onResponse:()=>{}});
     let chars=0,settled=false;
     for await(const event of inner){
      if(signal.aborted||closed)throw Error('stopped');
      if('delta'in event&&typeof event.delta==='string'){chars+=event.delta.length;if(chars>c.profile.limits.maxOutputCharacters)throw Error('output');}
      if(event.type==='error')throw Error('provider');
      if(event.type==='done'){
       reportCompletion(['stop','length','toolUse'].includes(event.reason)?event.reason as WireCompletion['sdkStop']:'other',event.message.content.filter(c=>c.type==='text').map(c=>c.text).join(''));
       if(!attempts.length)throw Error('no attempt');
       for(const a of attempts){if(gate.snapshot().entries.find(e=>e.callId===a.id)?.status==='rejected')continue;
        const usage=a.meter?.usage();if(!usage)throw Error('usage');
        const s=gate.settle(a.id,usage);if(s.locked)throw Error('overrun');}
       settled=true;
       if(attempts.length>1)recoveryEvent(deps.onRecovery,'http','recovered','valid',attempts.length);
       if(signal.aborted||closed)throw Error('stopped');
       closed=true;out.push(event);break;
      }
      out.push(event);
     }
     if(!settled)throw Error('incomplete');
    }catch{if(!closed){const aborted=signal.aborted;reportCompletion(aborted?'aborted':'error');closed=true;controller.abort();unknown();const e=failure();e.stopReason=aborted?'aborted':'error';
     out.push({type:'error',reason:aborted?'aborted':'error',error:e});}}
    finally{closed=true;clearTimeout(timer);signal.removeEventListener('abort',onStop);out.end();}
   })();return out;
  }});
 const model=runtime.getModel('interview-bailian',c.profile.modelId);if(!model)throw Error('LIVE_MODEL_CONFIG_INVALID');
 return{runtime,model};
}
