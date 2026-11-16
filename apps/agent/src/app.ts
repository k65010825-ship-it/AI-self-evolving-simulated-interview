import { Hono } from 'hono';
import{timingSafeEqual}from'node:crypto';
import{streamSSE}from'hono/streaming';
import{bodyLimit}from'hono/body-limit';
import { toProblem } from '../../../packages/contracts/src/errors.ts';
import{AgentRunCancelSchema}from'../../../packages/contracts/src/agent-run.ts';
import type{ErrorCode}from'../../../packages/contracts/src/tools.ts';
import{AgentStateError}from'./planning/interview-state.ts';
import type{AgentRunManager}from'./runtime/run-manager.ts';
import type{SpeechTaskManager}from'./speech/task-manager.ts';
import{SpeechOwnerSchema}from'../../../packages/contracts/src/speech-task.ts';
import{readSpeechBody}from'./speech/http-body.ts';
import{QuestionVoiceRequestSchema}from'../../../packages/contracts/src/tts.ts';
export function createAgentApp(options:{runtime?:AgentRunManager;speech?:SpeechTaskManager;synthesizeQuestion?:(input:unknown)=>Promise<Uint8Array>;internalToken?:string;runtimeMode?:'offline-runtime'|'live-runtime'}={}) {
  if((options.runtime||options.speech)&&(!options.internalToken||!/^[A-Za-z0-9_-]{32,256}$/.test(options.internalToken)))throw new Error('Explicit internal service token required');
  const problem=(code:ErrorCode)=>{const value=toProblem(code,crypto.randomUUID());return new Response(JSON.stringify(value),
   {status:value.status,headers:{'content-type':'application/problem+json'}});};
  const app = new Hono();
  app.get('/health', (c) => c.json({ service: 'agent', stage: options.runtime?(options.runtimeMode??'offline-runtime'):options.speech?'speech-runtime':'scaffold', liveModelConfigured: !!options.runtime&&options.runtimeMode==='live-runtime',
    capabilities: [...(options.runtime?['internal-in-memory-runtime','typed-sse',options.runtimeMode==='live-runtime'?'host-configured-model-transport':'offline-evaluator']:options.speech?[]:['offline-pi-spike', 'draft-seed-knowledge']),
     ...(options.speech?['internal-speech-tasks','sqlite-speech-operation-store']:[])] }));
  if(options.runtime||options.speech){
   app.use('/internal/v1/*',async(c,next)=>{
    const header=c.req.header('authorization')??'',expected=Buffer.from(`Bearer ${options.internalToken}`),actual=Buffer.from(header);
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return problem('UNAUTHENTICATED');await next();
   });
   app.use('/internal/v1/*',async(c,next)=>{
    if(c.req.path.startsWith('/internal/v1/speech/'))return next();
    return bodyLimit({maxSize:2*1024*1024,onError:()=>problem('CONTEXT_BUDGET_EXCEEDED')})(c,next);
   });
   const json=async(request:Request):Promise<unknown>=>{
    if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))throw new AgentStateError('VALIDATION_ERROR');
    try{return await request.json();}catch{throw new AgentStateError('VALIDATION_ERROR');}
   };
   if(options.speech){
    const speech=options.speech;
    const owner=(request:Request)=>{
     const p=SpeechOwnerSchema.safeParse({userId:request.headers.get('x-agent-user-id'),roleId:request.headers.get('x-agent-role-id')});
     if(!p.success)throw new AgentStateError('VALIDATION_ERROR');return p.data;
    };
    const speechJson=async(request:Request)=>{
     if((request.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()!=='application/json')throw new AgentStateError('VALIDATION_ERROR');
     const bytes=await readSpeechBody(request,2*1024*1024);
     try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{throw new AgentStateError('VALIDATION_ERROR');}
    };
    app.use('/internal/v1/speech/*',async(c,next)=>{
     c.header('Cache-Control','no-store');let release:(()=>void)|undefined;
     try{const match=c.req.method==='PUT'?/^\/internal\/v1\/speech\/tasks\/([^/]+)\/audio$/.exec(c.req.path):null;
      release=speech.acquireHttpSlot(match?.[1]);await next();
     }finally{release?.();if(c.req.raw.body&&!c.req.raw.bodyUsed)void c.req.raw.body.cancel().catch(()=>{});}
    });
    app.post('/internal/v1/speech/tasks',async c=>c.json(await speech.create(await speechJson(c.req.raw)),201));
    if(options.synthesizeQuestion)app.post('/internal/v1/speech/synthesis',async c=>{
     const p=QuestionVoiceRequestSchema.safeParse(await speechJson(c.req.raw));if(!p.success)throw new AgentStateError('VALIDATION_ERROR');
     const audio=await options.synthesizeQuestion!(p.data);return new Response(new Uint8Array(audio).buffer,{headers:{'content-type':'audio/wav','cache-control':'no-store'}});
    });
    app.get('/internal/v1/speech/tasks/:speechId',async c=>c.json(await speech.snapshot(c.req.param('speechId'),owner(c.req.raw))));
    app.put('/internal/v1/speech/tasks/:speechId/audio',async c=>{
     const subject=owner(c.req.raw);await speech.snapshot(c.req.param('speechId'),subject);
     if((c.req.header('content-type')??'').split(';')[0]?.trim().toLowerCase()!=='audio/wav')throw new AgentStateError('VALIDATION_ERROR');
     const bytes=await readSpeechBody(c.req.raw,4*1024*1024),s=await speech.upload(c.req.param('speechId'),subject,bytes,c.req.raw.signal);
     return c.json(s,s.status==='running'?202:200);
    });
    app.post('/internal/v1/speech/tasks/:speechId/confirmation',async c=>c.json(await speech.confirm(c.req.param('speechId'),owner(c.req.raw),await speechJson(c.req.raw))));
    app.post('/internal/v1/speech/tasks/:speechId/cancellation',async c=>{
     const input=await speechJson(c.req.raw);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new AgentStateError('VALIDATION_ERROR');
     return c.json(await speech.cancel(c.req.param('speechId'),owner(c.req.raw)),202);
    });
   }
   if(options.runtime){
   const runtime=options.runtime;
   app.post('/internal/v1/runs',async c=>c.json(runtime.start(await json(c.req.raw)),202));
   app.get('/internal/v1/runs/:runId',c=>c.json(runtime.snapshot(c.req.param('runId'))));
   app.post('/internal/v1/runs/:runId/cancellation',async c=>{
    const input=AgentRunCancelSchema.safeParse(await json(c.req.raw));if(!input.success)throw new AgentStateError('VALIDATION_ERROR');
    return c.json(runtime.cancel(c.req.param('runId'),input.data.attemptId),202);
   });
   app.get('/internal/v1/runs/:runId/events',c=>{
    const runId=c.req.param('runId'),snapshot=runtime.snapshot(runId),url=new URL(c.req.url);
    const values=url.searchParams.getAll('afterSeq'),last=c.req.header('last-event-id');
    if(values.length>1||[...url.searchParams.keys()].some(key=>key!=='afterSeq')||(values[0]!==undefined&&last!==undefined&&values[0]!==last))
     throw new AgentStateError('VALIDATION_ERROR');
    const cursor=values[0]??last??'0';if(!/^(0|[1-9]\d{0,8})$/.test(cursor))throw new AgentStateError('VALIDATION_ERROR');
    const after=Number(cursor);if(after>snapshot.lastEventSeq)throw new AgentStateError('VERSION_CONFLICT');
    c.header('Cache-Control','no-cache, no-transform');
    return streamSSE(c,async stream=>{
     const subscription=new AbortController();const abort=()=>subscription.abort();
     c.req.raw.signal.addEventListener('abort',abort,{once:true});stream.onAbort(abort);
     if(c.req.raw.signal.aborted)abort();
     try{for await(const event of runtime.events(runId,after,subscription.signal)){
       if(stream.aborted)break;await stream.writeSSE({id:String(event.seq),event:event.type,data:JSON.stringify(event)});
      }}finally{subscription.abort();c.req.raw.signal.removeEventListener('abort',abort);}
    },async(_error,stream)=>{stream.abort();});
   });
   }
  }
  app.notFound((c) => {
    const problem = toProblem(c.req.path.startsWith('/internal/v1/') ? 'NOT_IMPLEMENTED' : 'NOT_FOUND', crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: problem.status, headers: { 'content-type': 'application/problem+json' } });
  });
  app.onError((error) => {
    return problem(error instanceof AgentStateError?error.code:'INTERNAL_ERROR');
  });
  return app;
}
