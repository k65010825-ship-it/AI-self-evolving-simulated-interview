import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Database} from 'bun:sqlite';
import java from '../knowledge/java-backend/seed.json' with {type:'json'};import web from '../knowledge/web-frontend/seed.json' with {type:'json'};
import {createLocalHost} from '../apps/agent/src/local/host.ts';import {estimateSkills} from '../apps/agent/src/planning/interview-state.ts';import {recallStateEvidence} from '../apps/agent/src/memory/recall.ts';
import {WorkflowSchema} from '../packages/contracts/src/session-workflow.ts';
import {MemorySnapshotSchema,type MemorySnapshot} from '../packages/contracts/src/memory.ts';
test('new local sessions pin source-exact compatibility, preserve all raw history and restart without rewriting memory',async()=>{
 const data=await mkdtemp(join(tmpdir(),'local-memory-policy-'));let h=await createLocalHost({dataDir:data,assetsRoot:process.cwd()});
 const path=join(data,'agent','profiles','default','profile.sqlite'),at=Date.now(),memories=new Map<string,MemorySnapshot>(),sessions:string[]=[];
 try{
  for(const roleId of ['java-backend','web-frontend'] as const){
   const seed=roleId==='java-backend'?java:web,base=h.memory(roleId);
   const observation=(index:number,version:string,item=seed[0]!)=>({observationId:'o'+index,questionId:item.id,roleId,skillId:item.skillId,questionType:item.questionType,difficulty:item.difficulty,score:index===0?.9:.2,quality:1,observedAt:at-5000+index*1000,sessionId:'history-'+roleId,rubricId:item.id,rubricVersion:version,evidenceMode:'offline-fixture'});
   memories.set(roleId,MemorySnapshotSchema.parse({...base,version:1,updatedAt:at-1000,sessions:[{sessionId:'history-'+roleId,stateVersion:3,endedAt:at-2000,acceptedAt:at-1000,policyVersion:'old',evidenceMode:'offline-fixture',observations:[observation(0,'retired'),observation(1,seed[0]!.version),observation(2,seed[1]!.version,seed[1]!)]}]}));
  }
  await h.close();let db=new Database(path);try{for(const [role,m] of memories)db.query('INSERT INTO local_memory VALUES(?,?)').run(role,JSON.stringify(m));}finally{db.close();}
  h=await createLocalHost({dataDir:data,assetsRoot:process.cwd()});
  for(const roleId of ['java-backend','web-frontend'] as const){
   const c=h.command('session.create',{operationId:'create-'+roleId,roleId,goal:'memory policy',durationMinutes:20});await h.wait(c.jobId);expect(h.job(c.jobId).status).toBe('completed');sessions.push(c.sessionId);
   db=new Database(path,{readonly:true});let raw:unknown;try{raw=JSON.parse((db.query('SELECT workflow FROM local_sessions WHERE session_id=?').get(c.sessionId) as {workflow:string}).workflow);}finally{db.close();}
   const w=WorkflowSchema.parse(raw),seed=roleId==='java-backend'?java:web,policy=w.state.historyCompatibility;
   expect(policy?.mode).toBe('strict');expect(policy!.allowed).toHaveLength(seed.length);expect(w.state.priorEvidence).toHaveLength(3);
   const estimates=estimateSkills(w.state,Date.now());expect(estimates.find(s=>s.skillId===seed[0]!.skillId)?.mastery).toBeNull();expect(estimates.find(s=>s.skillId===seed[1]!.skillId)?.mastery).toBe(.2);
   const recall=recallStateEvidence(w.state,Date.now());expect(recall.selected.map(e=>e.questionId)).toEqual([seed[1]!.id]);expect(recall.askedQuestionIds).toContain(seed[0]!.id);
   const finish=h.command('session.complete',{operationId:'finish-'+roleId,sessionId:c.sessionId,expectedRevision:0});await h.wait(finish.jobId);expect(h.job(finish.jobId).status).toBe('completed');
   expect(h.memory(roleId)).toEqual(memories.get(roleId)!);
  }
  await h.close();h=await createLocalHost({dataDir:data,assetsRoot:process.cwd()});
  for(const id of sessions)expect(h.session(id)).toMatchObject({phase:'completed',priorEvidenceCount:3});
  expect(h.status()).toMatchObject({executionStarts:0,modelHttpAttempts:0});
 }finally{await h.close();await rm(data,{recursive:true,force:true});}
},15000);
