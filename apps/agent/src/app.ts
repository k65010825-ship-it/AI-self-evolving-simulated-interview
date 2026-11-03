import { Hono } from 'hono';
import{timingSafeEqual}from'node:crypto';
import{streamSSE}from'hono/streaming';
import{bodyLimit}from'hono/body-limit';
import { toProblem } from '../../../packages/contracts/src/errors.ts';
import{AgentRunCancelSchema}from'../../../packages/contracts/src/agent-run.ts';
import type{ErrorCode}from'../../../packages/contracts/src/tools.ts';
import{AgentStateError}from'./planning/interview-state.ts';
import type{AgentRunManager}from'./runtime/run-manager.ts';
export function createAgentApp(options:{runtime?:AgentRunManager;internalToken?:string}={}) {
  if(options.runtime&&(!options.internalToken||!/^[A-Za-z0-9_-]{32,256}$/.test(options.internalToken)))throw new Error('Explicit internal service token required');
  const problem=(code:ErrorCode)=>{const value=toProblem(code,crypto.randomUUID());return new Response(JSON.stringify(value),
   {status:value.status,headers:{'content-type':'application/problem+json'}});};
  const app = new Hono();
  app.get('/health', (c) => c.json({ service: 'agent', stage: options.runtime?'offline-runtime':'scaffold', liveModelConfigured: false,
    capabilities: options.runtime?['internal-in-memory-runtime','typed-sse','offline-evaluator']:['offline-pi-spike', 'draft-seed-knowledge'] }));
  if(options.runtime){
   const runtime=options.runtime;
   app.use('/internal/v1/*',async(c,next)=>{
    const header=c.req.header('authorization')??'',expected=Buffer.from(`Bearer ${options.internalToken}`),actual=Buffer.from(header);
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return problem('UNAUTHENTICATED');await next();
   });
   app.use('/internal/v1/*',bodyLimit({maxSize:2*1024*1024,onError:()=>problem('CONTEXT_BUDGET_EXCEEDED')}));
   const json=async(request:Request):Promise<unknown>=>{
    if(!(request.headers.get('content-type')??'').toLowerCase().startsWith('application/json'))throw new AgentStateError('VALIDATION_ERROR');
    try{return await request.json();}catch{throw new AgentStateError('VALIDATION_ERROR');}
   };
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
  app.notFound((c) => {
    const problem = toProblem(c.req.path.startsWith('/internal/v1/') ? 'NOT_IMPLEMENTED' : 'NOT_FOUND', crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: problem.status, headers: { 'content-type': 'application/problem+json' } });
  });
  app.onError((error) => {
    return problem(error instanceof AgentStateError?error.code:'INTERNAL_ERROR');
  });
  return app;
}
