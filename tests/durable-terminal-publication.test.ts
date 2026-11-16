import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createDurableLiveRunManager} from '../apps/agent/src/runtime/durable-runtime.ts';
import config from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
test('durable workflow publishes domain updates while running and seals only on run.completed',async()=>{
 const root=join(process.cwd(),'.cache','terminal-publication');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'run-')),now=Date.now();let calls=0;
 const c={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:now+60000,maxRuns:3}};
 const runtime=createDurableLiveRunManager(c,{readCredential:()=>{calls++;throw Error('forbidden');},fetch:async()=>{calls++;throw Error('forbidden');}},{path:join(dir,'agent.sqlite'),ownerId:'publication'});
 try{
  const identity={userId:'synthetic-publication',roleId:'java-backend' as const},context={...identity,runId:'publication-create',attemptId:'attempt',deadlineAt:now+60000};
  runtime.start({inputSnapshotId:context.runId,context,job:{type:'workflow',operation:{action:'create',config:{identity,
   session:{sessionId:'publication-session',roleId:identity.roleId,durationMinutes:20,skills:[{skillId:'skill',relevance:1}]},policy:{id:'p',roleId:identity.roleId,parameters:{}},goal:'synthetic',skillLabels:{skill:'synthetic'},now}}}});
  await runtime.wait(context.runId);const snapshot=runtime.snapshot(context.runId),events=[];
  for await(const e of runtime.events(context.runId))events.push(e);
  expect(snapshot.status).toBe('completed');expect(events.at(-1)!.type).toBe('run.completed');
  expect(events.filter(e=>e.type==='workflow.updated')).toHaveLength(1);expect(events.filter(e=>e.type==='run.completed')).toHaveLength(1);
  expect(events.at(-1)!.seq).toBe(snapshot.lastEventSeq);expect(calls).toBe(0);
 }finally{runtime.close();}
});
