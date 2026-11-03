import{z}from'zod';
import{AgentRunRequestSchema,AgentRunSnapshotSchema,AgentRunEventSchema,AgentRunCancelSchema,ErrorCodeSchema,describeError,
 type AgentRunRequest,type AgentRunSnapshot,type AgentRunEvent}from'@interview/contracts';
import{AgentClientError,clientError,normalize}from'./errors.ts';
import{RequestScope,readJson,delay}from'./transport.ts';
import{parseSse}from'./sse.ts';
export{AgentClientError}from'./errors.ts';
export { createWorkflowCommitTicket, prepareWorkflowCommit, WorkflowCommitError, workflowCommitDigest } from './workflow-commit.ts';
export type{ClientErrorCode}from'./errors.ts';
export type{AgentRunRequest,AgentRunSnapshot,AgentRunEvent};
export type FetchTransport=(url:string,init?:RequestInit)=>Promise<Response>;
const Config=z.object({baseUrl:z.string().min(1),internalToken:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
 requestTimeoutMs:z.number().int().min(1).max(60000).default(10000),maxResponseBytes:z.number().int().min(1).max(32*1024*1024).default(16*1024*1024),
 maxSseFrameBytes:z.number().int().min(1).max(1024*1024).default(64*1024)}).strict();
const EventOptions=z.object({attemptId:z.string().min(1),afterSeq:z.number().int().min(0).max(999999999).default(0),
 timeoutMs:z.number().int().min(1).max(300000).default(30000),idleTimeoutMs:z.number().int().min(1).max(300000).default(10000),
 maxReconnects:z.number().int().min(0).max(5).default(2),reconnectDelayMs:z.number().int().min(0).max(5000).default(100)}).strict();
export interface CallOptions{signal?:AbortSignal;attemptId?:string;}
export interface EventsOptions{attemptId:string;afterSeq?:number;timeoutMs?:number;idleTimeoutMs?:number;maxReconnects?:number;reconnectDelayMs?:number;signal?:AbortSignal;}
const terminal=(s:AgentRunSnapshot['status'])=>s==='completed'||s==='failed'||s==='cancelled';
function decode<T>(schema:z.ZodType<T>,value:unknown):T{const p=schema.safeParse(value);if(!p.success)throw clientError('PROTOCOL_ERROR');return p.data;}
function id(value:string){if(typeof value!=='string'||!value.length||value.length>1000||value==='.'||value==='..'||/[\x00-\x1f\x7f]/.test(value))throw clientError('CLIENT_VALIDATION');return encodeURIComponent(value);}

/** Backend only: configure credentials explicitly; do not import into Electron renderer. */
export function createAgentClient(input:{baseUrl:string;internalToken:string;fetch?:FetchTransport;requestTimeoutMs?:number;maxResponseBytes?:number;maxSseFrameBytes?:number}){
 const{fetch:customFetch,...raw}=input,p=Config.safeParse(raw);if(!p.success)throw clientError('CLIENT_VALIDATION');const config=p.data;
 let base:URL;try{base=new URL(config.baseUrl);}catch{throw clientError('CLIENT_VALIDATION');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw clientError('CLIENT_VALIDATION');
 const transport=customFetch??((url,init)=>fetch(url,init));if(typeof transport!=='function')throw clientError('CLIENT_VALIDATION');
 const headers={authorization:`Bearer ${config.internalToken}`};
 async function fetchResponse(path:string,scope:RequestScope,method='GET',body?:string){
  scope.check();const response=await scope.race(Promise.resolve().then(()=>{scope.check();return transport(`${base.origin}${path}`,{
   method,headers:{...headers,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body}:{}),signal:scope.signal,redirect:'error'});}).then(response=>{
    if(scope.signal.aborted){void response.body?.cancel().catch(()=>{});scope.check();throw clientError('ABORTED');}return response;}));
  if(response.redirected||(response.url&&response.url!==`${base.origin}${path}`))throw clientError('PROTOCOL_ERROR');return response;
 }
 async function problem(response:Response,scope:RequestScope):Promise<never>{
  const raw=await readJson(response,scope,config.maxResponseBytes);
  if(!raw||typeof raw!=='object')throw clientError('PROTOCOL_ERROR');const p=raw as Record<string,unknown>,code=ErrorCodeSchema.safeParse(p.code);
  if(!code.success||p.status!==response.status)throw clientError('PROTOCOL_ERROR');const expected=describeError(code.data);
  if(expected.status!==response.status||p.retryable!==expected.retryable)throw clientError('PROTOCOL_ERROR');
  const requestId=typeof p.requestId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(p.requestId)&&!p.requestId.includes(config.internalToken)?p.requestId:undefined;
  throw new AgentClientError(code.data,response.status,expected.retryable,requestId);
 }
 function snapshot(raw:unknown,runId:string,attemptId?:string){
  const s=decode(AgentRunSnapshotSchema,raw);
  if(s.runId!==runId||(attemptId!==undefined&&s.attemptId!==attemptId)||s.lastEventSeq<1||Date.parse(s.updatedAt)<Date.parse(s.createdAt)||
   ((s.status==='failed'||s.status==='cancelled')!== (s.error!==null))||(terminal(s.status)&&s.stage!==null))throw clientError('PROTOCOL_ERROR');
  if(s.error){const expected=describeError(s.error.code);if(s.error.retryable!==expected.retryable)throw clientError('PROTOCOL_ERROR');
   s.error={code:s.error.code,message:expected.message,retryable:expected.retryable};}return s;
 }
 async function requestSnapshot(path:string,runId:string,options:CallOptions={},method='GET',body?:string,scope?:RequestScope){
  const own=!scope,active=scope??new RequestScope(config.requestTimeoutMs,options.signal);
  try{const response=await fetchResponse(path,active,method,body);const expected=method==='POST'?202:200;
   if(response.status!==expected){if(!response.ok)return await problem(response,active);throw clientError('PROTOCOL_ERROR');}
   if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')throw clientError('PROTOCOL_ERROR');
   const result=snapshot(await readJson(response,active,config.maxResponseBytes),runId,options.attemptId);active.check();return result;
  }catch(error){throw normalize(error);}finally{if(own)active.dispose();}
 }
 async function startRun(raw:AgentRunRequest,options:CallOptions={}){
  const parsed=AgentRunRequestSchema.safeParse(raw);if(!parsed.success)throw clientError('CLIENT_VALIDATION');
  const body=JSON.stringify(parsed.data);if(new TextEncoder().encode(body).length>2*1024*1024)throw clientError('CLIENT_VALIDATION');id(parsed.data.context.runId);id(parsed.data.context.attemptId);
  const result=await requestSnapshot('/internal/v1/runs',parsed.data.context.runId,{...options,attemptId:parsed.data.context.attemptId},'POST',body);
  if(result.inputSnapshotId!==parsed.data.inputSnapshotId)throw clientError('PROTOCOL_ERROR');return result;
 }
 const getRun=async(runId:string,options:CallOptions={})=>requestSnapshot(`/internal/v1/runs/${id(runId)}`,runId,options);
 async function cancelRun(runId:string,attemptId:string,options:CallOptions={}){
  id(attemptId);const body=AgentRunCancelSchema.parse({attemptId});
  return requestSnapshot(`/internal/v1/runs/${id(runId)}/cancellation`,runId,{...options,attemptId},'POST',JSON.stringify(body));
 }
 async function* events(runId:string,rawOptions:EventsOptions):AsyncGenerator<AgentRunEvent>{
  const path=`/internal/v1/runs/${id(runId)}/events`,{signal,...raw}=rawOptions,parsed=EventOptions.safeParse(raw);
  if(!parsed.success)throw clientError('CLIENT_VALIDATION');const o=parsed.data;id(o.attemptId);
  const scope=new RequestScope(o.timeoutMs,signal);let cursor=o.afterSeq,last:string|undefined;
  try{
   for(let attempt=0;attempt<=o.maxReconnects;attempt++){
    let error=clientError('NETWORK_ERROR');
    try{
     scope.check();const url=`${base.origin}${path}`;
     const response=await scope.race(Promise.resolve().then(()=>{scope.check();return transport(url,{headers:{...headers,...(cursor?{'Last-Event-ID':String(cursor)}:{})},signal:scope.signal,redirect:'error'});}).then(response=>{
      if(scope.signal.aborted){void response.body?.cancel().catch(()=>{});scope.check();throw clientError('ABORTED');}return response;}));
     if(response.redirected||(response.url&&response.url!==url))throw clientError('PROTOCOL_ERROR');
     if(response.status!==200){if(!response.ok)return await problem(response,scope);throw clientError('PROTOCOL_ERROR');}
     if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='text/event-stream')throw clientError('PROTOCOL_ERROR');
     for await(const frame of parseSse(response,scope,config.maxSseFrameBytes,o.idleTimeoutMs)){
      if(!/^[1-9]\d{0,8}$/.test(frame.id))throw clientError('PROTOCOL_ERROR');let raw:unknown;
      try{raw=JSON.parse(frame.data);}catch{throw clientError('PROTOCOL_ERROR');}
      const event=decode(AgentRunEventSchema,raw),serialized=JSON.stringify(event);scope.check();
      if(event.runId!==runId||event.attemptId!==o.attemptId||event.type!==frame.event||event.seq!==Number(frame.id))throw clientError('PROTOCOL_ERROR');
      if(event.seq<=cursor){if(event.seq===cursor&&last!==undefined&&last!==serialized)throw clientError('PROTOCOL_ERROR');continue;}
      if(event.seq!==cursor+1)throw clientError('PROTOCOL_ERROR');cursor=event.seq;last=serialized;
      yield event;if(event.type==='run.completed'||event.type==='run.failed'||event.type==='run.cancelled')return;
     }
     const latest=await requestSnapshot(`/internal/v1/runs/${id(runId)}`,runId,{attemptId:o.attemptId},'GET',undefined,scope);
     if(latest.lastEventSeq<cursor)throw clientError('PROTOCOL_ERROR');
     if(terminal(latest.status)&&latest.lastEventSeq===cursor)return;
    }catch(rawError){scope.check();error=normalize(rawError);if(error.code!=='NETWORK_ERROR'&&error.code!=='TIMEOUT')throw error;}
    if(attempt===o.maxReconnects)throw error;await delay(o.reconnectDelayMs,scope);
   }
  }finally{scope.dispose();}
 }
 async function waitForRun(runId:string,options:EventsOptions){
  const{signal,...rest}=options,parsed=EventOptions.safeParse(rest);if(!parsed.success)throw clientError('CLIENT_VALIDATION');
  const scope=new RequestScope(parsed.data.timeoutMs,signal);
  try{
   let result=await requestSnapshot(`/internal/v1/runs/${id(runId)}`,runId,{attemptId:options.attemptId},'GET',undefined,scope);
   if(result.lastEventSeq<parsed.data.afterSeq)throw clientError('PROTOCOL_ERROR');
   let terminalEvent:AgentRunEvent|undefined;
   if(!terminal(result.status)){
    for await(const event of events(runId,{...options,signal:scope.signal}))if(['run.completed','run.failed','run.cancelled'].includes(event.type))terminalEvent=event;
    result=await requestSnapshot(`/internal/v1/runs/${id(runId)}`,runId,{attemptId:options.attemptId},'GET',undefined,scope);
   }
   if(!terminal(result.status)|| (terminalEvent&&result.lastEventSeq<terminalEvent.seq)||
    (terminalEvent?.type==='run.completed'&&(result.status!=='completed'||result.result?.kind!==terminalEvent.payload.resultKind))||
    (terminalEvent?.type==='run.failed'&&(result.status!=='failed'||result.error?.code!==terminalEvent.payload.error.code))||
    (terminalEvent?.type==='run.cancelled'&&result.status!=='cancelled'))throw clientError('PROTOCOL_ERROR');
   if(result.status!=='completed')throw new AgentClientError(result.error!.code,undefined,result.error!.retryable);return result;
  }finally{scope.dispose();}
 }
 async function executeRun(rawRequest:AgentRunRequest,options:Omit<EventsOptions,'attemptId'|'afterSeq'>={}){
  const parsed=AgentRunRequestSchema.safeParse(rawRequest);if(!parsed.success)throw clientError('CLIENT_VALIDATION');const request=parsed.data;
  const{signal,...rawOptions}=options,checked=EventOptions.safeParse({...rawOptions,attemptId:request.context.attemptId});
  if(!checked.success)throw clientError('CLIENT_VALIDATION');
  const scope=new RequestScope(checked.data.timeoutMs,signal);
  try{
   const accepted=await scope.race(startRun(request,{signal:scope.signal}));
   const result=await scope.race(waitForRun(accepted.runId,{...checked.data,signal:scope.signal}));
   const kinds={turn:'uncommitted-turn-result',report:'uncommitted-report-result',workflow:'uncommitted-workflow-result',rsi:'uncommitted-workflow-rsi'}as const;
   const expected=kinds[request.job.type];
   if(result.inputSnapshotId!==request.inputSnapshotId||result.result?.kind!==expected||
    (request.job.type==='workflow'&&result.result.kind==='uncommitted-workflow-result'&&result.result.action!==request.job.operation.action))throw clientError('PROTOCOL_ERROR');
   scope.check();return result;
  }finally{scope.dispose();}
 }
 return{startRun,getRun,cancelRun,events,waitForRun,executeRun};
}
