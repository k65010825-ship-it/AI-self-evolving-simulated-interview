import { test, expect } from 'bun:test';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPilotService, type PilotOptions } from '../apps/api/src/pilot/service.ts';
import { createRunManager } from '../apps/agent/src/runtime/run-manager.ts';
import { createWorkflowFixture } from '../experiments/session/fixture.ts';
import type { AgentRunRequest } from '../packages/contracts/src/agent-run.ts';
import type { SpeechTaskCreate } from '../packages/contracts/src/speech-task.ts';

async function harness(extra: Partial<PilotOptions> = {}, insufficientFirst = false) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-security-'));
  const fixture = await createWorkflowFixture();
  let evaluations = 0;
  const runtime = createRunManager({ planForRole: () => fixture.plan, evaluateForRole: () => async (request, signal) => {
    evaluations++;
    if (insufficientFirst && evaluations === 1) return { evidence: [], criterionScores: request.rubric.criteria.map(c => ({criterionId:c.id,score:null,evidenceIds:[]})), feedback:{strengths:[],improvements:['需要补充原始证据']} };
    return fixture.evaluate(request, signal);
  }});
  const requests: AgentRunRequest[] = [];
  const service = createPilotService({ path:join(dir,'pilot.sqlite'), users:[{userId:'alice',name:'Alice',password:'fixture-password-alice'}], evidenceMode:'offline-fixture', allowDraftKnowledge:true,
    run:async request=>{requests.push(structuredClone(request));runtime.start(request);await runtime.wait(request.context.runId);return runtime.snapshot(request.context.runId);}, ...extra });
  return {service,requests,async start(){const r=service.createSession('alice',{operationId:'create',roleId:'java-backend',goal:'练习',durationMinutes:20});await service.wait(r.operationId);expect(service.getOperation('alice','create').status).toBe('completed');return r.sessionId;},async plan(sessionId:string,id='plan'){const c={operationId:id,expectedRevision:service.getSession('alice',sessionId).revision};service.nextQuestion('alice',sessionId,c);await service.wait(id);expect(service.getOperation('alice',id).status).toBe('completed');return c;}, cleanup(){service.close();runtime.dispose();for(const name of readdirSync(dir))unlinkSync(join(dir,name));rmdirSync(dir);}};
}
const creation={operationId:'same-create',roleId:'java-backend',goal:'练习',durationMinutes:20};

test('session admission failure rolls back sessions and operation before same-key retries',async()=>{
 const h=await harness({onSession:()=>{throw Error('injected admission failure');}});
 try{for(let i=0;i<2;i++){expect(()=>h.service.createSession('alice',creation)).toThrow('injected admission failure');expect(h.service.listSessions('alice')).toHaveLength(0);expect(()=>h.service.getOperation('alice','same-create')).toThrow();}await Promise.resolve();expect(h.requests).toHaveLength(0);}finally{h.cleanup();}
});

test('asynchronous admission cannot dispatch or leave a formal operation',async()=>{
 const h=await harness({onSession:async()=>{await Promise.resolve();throw Error('async admission rejected');}});
 try{expect(()=>h.service.createSession('alice',creation)).toThrow();await new Promise(r=>setTimeout(r,0));expect(h.requests).toHaveLength(0);expect(h.service.listSessions('alice')).toHaveLength(0);expect(()=>h.service.getOperation('alice','same-create')).toThrow();}finally{h.cleanup();}
});

test('plan and completion cannot reuse one operation id, while exact create and plan replay stay idempotent',async()=>{
 const h=await harness();try{const id=await h.start(),command=await h.plan(id),calls=h.requests.length;
  expect(()=>h.service.completeSession('alice',id,command)).toThrow('VERSION_CONFLICT');
  expect(h.service.nextQuestion('alice',id,command)).toEqual({sessionId:id,operationId:'plan'});
  expect(h.service.createSession('alice',{operationId:'create',roleId:'java-backend',goal:'练习',durationMinutes:20})).toEqual({sessionId:id,operationId:'create'});
  await Promise.resolve();expect(h.requests).toHaveLength(calls);expect(h.service.getSession('alice',id).phase).toBe('awaiting_answer');
 }finally{h.cleanup();}
});

test('resolved clarification retains original once and cannot leak its prompt, prefix or observation into the next question',async()=>{
 const h=await harness({},true);try{const id=await h.start();await h.plan(id);let v=h.service.getSession('alice',id);const original='我的原始回答';
  h.service.submitAnswer('alice',id,{operationId:'answer-1',expectedRevision:v.revision,text:original});await h.service.wait('answer-1');expect(h.service.getOperation('alice','answer-1').status).toBe('completed');v=h.service.getSession('alice',id);expect(v.clarification?.previousText).toBe(original);
  const completeText=original+'\n补充：我先界定业务约束和失败恢复。';h.service.submitAnswer('alice',id,{operationId:'answer-2',expectedRevision:v.revision,text:completeText});await h.service.wait('answer-2');expect(h.service.getOperation('alice','answer-2').status).toBe('completed');expect(h.service.getSession('alice',id).scoredCount).toBe(1);expect(h.service.getSession('alice',id).clarification).toBeNull();
  await h.plan(id,'plan-next');v=h.service.getSession('alice',id);expect(v.clarification).toBeNull();const nextAnswer='下一题独立作答，通过事务边界与补偿机制处理失败。';h.service.submitAnswer('alice',id,{operationId:'answer-next',expectedRevision:v.revision,text:nextAnswer});await h.service.wait('answer-next');expect(h.service.getOperation('alice','answer-next').status).toBe('completed');expect(h.service.getSession('alice',id).scoredCount).toBe(2);
  const answers=h.requests.filter(r=>r.job.type==='workflow'&&r.job.operation.action==='answer').map(r=>{if(r.job.type!=='workflow'||r.job.operation.action!=='answer')throw Error('bad filter');return r.job.operation.command;});expect(answers[1]!.answer.text).toBe(completeText);expect(answers[2]!.answer.text).toBe(nextAnswer);expect(answers[2]!.observationId).not.toBe(answers[0]!.observationId);
 }finally{h.cleanup();}
});

for(const method of ['create','get','upload','confirm'] as const)test(`speech ${method} rejects upstream snapshots bound to another user`,async()=>{
 let request:SpeechTaskCreate|undefined,wrong=false;
 const response=()=>{if(!request)throw Error('missing request');const copy=structuredClone(request);if(wrong)copy.context.userId='bob';return{schemaVersion:1,kind:'uncommitted-speech-task',request:copy,version:0,status:'awaiting_audio',createdAt:Date.now(),updatedAt:Date.now()};};
 const gateway:NonNullable<PilotOptions['speech']>={create:async r=>{request=r;return response();},get:async()=>response(),upload:async()=>response(),confirm:async()=>response(),cancel:async()=>response()};
 const h=await harness({speech:gateway});try{const id=await h.start();await h.plan(id);const command={expectedRevision:h.service.getSession('alice',id).revision,sha256:'0'.repeat(64),byteLength:44};
  if(method==='create'){wrong=true;await expect(h.service.createSpeech('alice',id,command)).rejects.toThrow();}
  else{const speech=await h.service.createSpeech('alice',id,command);wrong=true;
   if(method==='get')await expect(h.service.getSpeech('alice',speech.speechId)).rejects.toThrow();
   if(method==='upload')await expect(h.service.uploadSpeech('alice',speech.speechId,new Uint8Array(44))).rejects.toThrow();
   if(method==='confirm')await expect(h.service.confirmSpeech('alice',speech.speechId,{expectedVersion:0,text:'confirmed'})).rejects.toThrow();
  }
 }finally{h.cleanup();}
});

