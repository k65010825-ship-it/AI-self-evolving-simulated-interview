import { test,expect } from 'bun:test';
import { runtimeRequest } from './helpers/runtime-request.ts';
import { createRunManager } from '../apps/agent/src/runtime/run-manager.ts';
import { createAgentApp } from '../apps/agent/src/app.ts';
import { createAgentClient } from '../packages/agent-client/src/index.ts';
import { AgentRunRequestSchema } from '../packages/contracts/src/agent-run.ts';
const empty=()=>({evidence:[],criterionScores:[{criterionId:'correctness',score:null,evidenceIds:[]}],feedback:{strengths:[],improvements:['补充说明']}});
test('runtime exposes clarification as a completed unscored result with safe events, no question or state commit',async()=>{
 const raw=runtimeRequest('clarify-runtime'),input={...raw,job:{...raw.job,clarification:{}}},before=JSON.stringify(input);
 let calls=0;const manager=createRunManager({evaluateForRole:()=>async()=>{calls++;return empty();}});
 try{
  manager.start(input);await manager.wait(raw.context.runId);const r=manager.snapshot(raw.context.runId);
  expect(r.status).toBe('completed');expect(r.result?.kind).toBe('uncommitted-unscored-turn-result');
  if(r.result?.kind!=='uncommitted-unscored-turn-result')throw Error('expected unscored');
  expect(r.result.resolution.status).toBe('needs_clarification');expect(r.result.selection).toBeUndefined();
  const events=[];for await(const e of manager.events(raw.context.runId))events.push(e);
  expect(events.some(e=>e.type==='answer.resolution')).toBe(true);expect(events.some(e=>e.type==='question.completed')).toBe(false);
  expect(JSON.stringify(events)).not.toContain('事务边界');expect(JSON.stringify(input)).toBe(before);
  manager.start(input);expect(calls).toBe(1);
 }finally{manager.dispose();}
});
test('insufficient session time finishes without issuing a new question or low-score observation',async()=>{
 const raw=runtimeRequest('clarify-time'),request={...raw,job:{...raw.job,clarification:{}}};
 request.job.input.state.deadlineAt=Date.now()+30000;
 const manager=createRunManager({evaluateForRole:()=>async()=>empty()});
 try{
  manager.start(request);await manager.wait(raw.context.runId);const result=manager.snapshot(raw.context.runId).result;
  if(result?.kind!=='uncommitted-unscored-turn-result')throw Error('expected unscored');
  expect(result.resolution.reason).toBe('time_budget');expect(result.selection?.status).toBe('finished');
  const events=[];for await(const e of manager.events(raw.context.runId))events.push(e);
  expect(events.some(e=>e.type==='question.completed')).toBe(false);
 }finally{manager.dispose();}
});
test('backend client consumes explicit abstention over actual internal HTTP/SSE without treating null as a failed run',async()=>{
 const raw=runtimeRequest('abstain-runtime'),request=AgentRunRequestSchema.parse({...raw,job:{...raw.job,clarification:{policy:{maxClarifications:0,minRemainingSeconds:45}}}});
 let release!:(value:ReturnType<typeof empty>)=>void;
 const gate=new Promise<ReturnType<typeof empty>>(resolve=>{release=resolve;});
 const runtime=createRunManager({evaluateForRole:()=>async()=>gate}),token='clarification_test_service_token_1234567890';
 const paths:string[]=[];let frames:Promise<string>|undefined;
 try{
  const app=createAgentApp({runtime,internalToken:token}),client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>{
   const path=new URL(url).pathname;paths.push(path);const response=await app.request(new Request(url,init));
   if(path.endsWith('/events')){frames=response.clone().text();queueMicrotask(()=>release(empty()));}return response;
  }});
  const result=await client.executeRun(request);
  expect(result.status).toBe('completed');expect(result.result?.kind).toBe('uncommitted-unscored-turn-result');
  if(result.result?.kind!=='uncommitted-unscored-turn-result')throw Error('expected unscored');
  expect(result.result.resolution.status).toBe('abstained');expect(result.result.resolution.normalizedScore).toBeNull();
  expect(result.result.selection).toBeDefined();
  expect(paths.some(p=>p.endsWith('/events'))).toBe(true);
  const sse=await frames;expect(sse).toContain('event: answer.resolution');expect(sse).toContain('event: run.completed');
  expect(sse).toContain('uncommitted-unscored-turn-result');
 }finally{release(empty());runtime.dispose();}
});
