import{test,expect}from'bun:test';
import{createAgentClient}from'../packages/agent-client/src/index.ts';
import{createInterviewWorkflow}from'../apps/agent/src/orchestration/session-workflow.ts';
const token='client-sse-local-internal-token-1234567',runId='r',attemptId='a';
const encoder=new TextEncoder();
const event=(seq:number,type='run.stage',payload:unknown={stage:'evaluating',message:'正在分析中文回答'})=>({schemaVersion:1,runId,attemptId,seq,occurredAt:'2026-11-02T00:00:00.000Z',type,payload});
const frame=(e:ReturnType<typeof event>,newline='\n')=>`id: ${e.seq}${newline}event: ${e.type}${newline}data: ${JSON.stringify(e)}${newline}${newline}`;
const completed=(seq:number)=>event(seq,'run.completed',{resultKind:'uncommitted-workflow-result',committed:false});
function sse(chunks:(Uint8Array|string)[]){return new Response(new ReadableStream<Uint8Array>({start(c){for(const b of chunks)c.enqueue(typeof b==='string'?encoder.encode(b):b);c.close();}}),{headers:{'content-type':'text/event-stream'}});}
function snapshot(status='running',seq=1){const now=Date.now(),identity={userId:'u',roleId:'java-backend'};
 const workflow=createInterviewWorkflow({identity,session:{sessionId:'s',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'project-design',relevance:1}]},
  policy:{id:'p',roleId:'java-backend',parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'test',skillLabels:{'project-design':'项目'},now});
 return{runId,attemptId,inputSnapshotId:'s',status,stage:status==='running'?'evaluating':null,createdAt:'2026-11-02T00:00:00.000Z',updatedAt:'2026-11-02T00:00:00.000Z',lastEventSeq:seq,
  error:status==='failed'?{code:'DEPENDENCY_UNAVAILABLE',message:'private upstream detail',retryable:true}:null,
  result:status==='completed'?{kind:'uncommitted-workflow-result',action:'create',snapshot:workflow}:null};
}
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('SSE parses one-byte UTF-8 chunks, CRLF/CR/LF, comments and multiline data',async()=>{
 const first=event(1),last=completed(2);
 const multiline=JSON.stringify(first,null,2).split('\n').map(s=>`data: ${s}`).join('\r\n');
 const bytes=encoder.encode(`: heartbeat\r\n\r\nid: 1\r\nevent: run.stage\r\n${multiline}\r\n\r\n`+frame(last,'\r'));
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>sse([...bytes].map(b=>new Uint8Array([b])))});
 const received=[];for await(const e of client.events(runId,{attemptId}))received.push(e);
 expect(JSON.stringify(received)).toBe(JSON.stringify([first,last]));
});

test('truncated connection reconnects from last validated cursor and removes matching replay duplicates',async()=>{
 const first=event(1),second=event(2),last=completed(3);let connects=0;const cursors:(string|null)[]=[];
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>{
  if(!url.endsWith('/events'))return json(snapshot());cursors.push(new Headers(init?.headers).get('last-event-id'));connects++;
  return connects===1?sse([frame(first),'id: 2\nevent: run.stage\ndata: {"incomplete"']):sse([frame(first)+frame(second)+frame(last)]);
 }});
 const received=[];for await(const e of client.events(runId,{attemptId,reconnectDelayMs:0}))received.push(e.seq);
 expect(received).toEqual([1,2,3]);expect(cursors).toEqual([null,'1']);
});

test('wrong run, attempt, event id/type, conflicting duplicate and gaps are protocol failures without reconnect',async()=>{
 for(const text of [frame({...event(1),runId:'other'}),frame({...event(1),attemptId:'other'}),frame(event(2)),
  frame(event(1)).replace('id: 1','id: 2'),frame(event(1)).replace('event: run.stage','event: run.failed'),
  frame(event(1))+frame(event(1,'run.stage',{stage:'evaluating',message:'changed'})),
  'id: 1\nevent: run.stage\ndata: invalid json\n\n']){
  let calls=0;const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>{calls++;return sse([text]);}});
  await expect((async()=>{for await(const _ of client.events(runId,{attemptId})){} })()).rejects.toMatchObject({code:'PROTOCOL_ERROR'});expect(calls).toBe(1);
 }
});

test('cursor already at terminal completes after snapshot confirmation without synthesizing events',async()=>{
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url)=>url.endsWith('/events')?sse([]):json(snapshot('completed',3))});
 const received=[];for await(const e of client.events(runId,{attemptId,afterSeq:3}))received.push(e);
 expect(received).toEqual([]);
});

test('a terminal snapshot behind the supplied cursor is rejected rather than silently rolling back',async()=>{
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url)=>url.endsWith('/events')?sse([]):json(snapshot('completed',2))});
 await expect((async()=>{for await(const _ of client.events(runId,{attemptId,afterSeq:3})){} })()).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
 await expect(client.waitForRun(runId,{attemptId,afterSeq:3})).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
});

test('nonterminal EOF exhausts a finite reconnect budget',async()=>{
 let connects=0;const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url)=>{
  if(url.endsWith('/events')){connects++;return sse([]);}return json(snapshot());}});
 await expect((async()=>{for await(const _ of client.events(runId,{attemptId,maxReconnects:1,reconnectDelayMs:0})){} })()).rejects.toMatchObject({code:'NETWORK_ERROR'});
 expect(connects).toBe(2);
});

test('idle connections are bounded and subscriptions cancel locally without issuing remote cancellation',async()=>{
 let cancelled=0;const paths:string[]=[];
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url)=>{paths.push(url);return new Response(new ReadableStream<Uint8Array>({cancel(){cancelled++;}}),{headers:{'content-type':'text/event-stream'}});}});
 await expect((async()=>{for await(const _ of client.events(runId,{attemptId,idleTimeoutMs:5,maxReconnects:0})){} })()).rejects.toMatchObject({code:'TIMEOUT'});
 expect(cancelled).toBe(1);expect(paths.some(p=>p.endsWith('/cancellation'))).toBe(false);
});

test('frame and total time budgets hold even for an always-ready duplicate stream',async()=>{
 const oversized=createAgentClient({baseUrl:'http://agent.local',internalToken:token,maxSseFrameBytes:8,fetch:async()=>sse([frame(event(1))])});
 await expect((async()=>{for await(const _ of oversized.events(runId,{attemptId})){} })()).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
 let cancelled=false;
 const ready=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>new Response(new ReadableStream<Uint8Array>({pull(c){c.enqueue(encoder.encode(frame(event(1))));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})});
 await expect((async()=>{for await(const _ of ready.events(runId,{attemptId,timeoutMs:10})){} })()).rejects.toMatchObject({code:'TIMEOUT'});expect(cancelled).toBe(true);
});

test('waitForRun turns a failed terminal snapshot into a static typed error, and validates terminal event consistency',async()=>{
 const failed=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>json(snapshot('failed',3))});
 await expect(failed.waitForRun(runId,{attemptId})).rejects.toMatchObject({code:'DEPENDENCY_UNAVAILABLE'});
 let gets=0;const mismatch=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url)=>url.endsWith('/events')?sse([frame(completed(1))]):json(snapshot(++gets===1?'running':'failed',1))});
 await expect(mismatch.waitForRun(runId,{attemptId})).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
});
