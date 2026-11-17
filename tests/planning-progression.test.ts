import {test,expect} from 'bun:test';
import {createInterviewState,recordObservation,decideNextAction} from '../apps/agent/src/planning/interview-state.ts';
import type {RoleId} from '../packages/contracts/src/tools.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
const at=1000000;
const policy={maxFollowupDepth:5,maxTurns:12,wrapUpSeconds:30,difficultyProgression:'independent-evidence-v1'};
function strong(roleId:RoleId='java-backend',scores=[.9,.9],difficulty=2){
 let s=createInterviewState({sessionId:'progress',roleId,durationMinutes:20,skills:[{skillId:'s',relevance:1}]},at);
 for(const [i,score] of scores.entries())s=recordObservation(s,{observationId:'o'+i,questionId:'q'+i,roleId,skillId:'s',
  questionType:i%2?'technical':'scenario',difficulty,score,quality:1,observedAt:at+i+1},s.version,at+i+1);
 return s;
}
test('both roles escalate one level only with pinned progression and independent current-level evidence',()=>{
 for(const role of ['java-backend','web-frontend'] as const){
  const s=strong(role),before=structuredClone(s);
  expect(decideNextAction(s,at+10,policy)).toMatchObject({action:'adjust_difficulty',difficulty:3,reason:'strong_independent_evidence'});
  expect(s).toEqual(before);
  // Old policy IDs/snapshots retain exact replay behavior.
  expect(decideNextAction(s,at+10,{maxFollowupDepth:5})).toMatchObject({action:'deepen',difficulty:2});
 }
});
test('single, repeated, weak or low-quality answers never justify escalation',()=>{
 const single=strong('java-backend',[1]),mixed=strong('java-backend',[1,.5]),quality=strong();
 quality.observations[1]!.quality=.2;
 const repeated=strong();repeated.observations[1]!.questionId='q0';
 for(const s of [single,mixed,quality,repeated])expect(decideNextAction(s,at+10,policy).difficulty).toBe(2);
});
test('easier evidence cannot staircase difficulty; latest independent answers and question variety matter',()=>{
 const lower=strong();
 const raised=recordObservation(lower,{observationId:'o2',questionId:'q2',roleId:lower.roleId,skillId:'s',questionType:'scenario',difficulty:3,score:1,quality:1,observedAt:at+4},2,at+4);
 expect(decideNextAction(raised,at+10,policy).difficulty).toBe(3);
 const recentWeak=strong('java-backend',[.9,.9,.6]);expect(decideNextAction(recentWeak,at+10,policy).difficulty).toBe(2);
 const sameType=strong();sameType.observations[1]!.questionType='scenario';expect(decideNextAction(sameType,at+10,policy).difficulty).toBe(2);
});
test('time, turn and depth caps take precedence; difficulty never exceeds five',()=>{
 const s=strong();
 expect(decideNextAction(s,s.deadlineAt-179000,policy).difficulty).toBe(2);
 expect(decideNextAction(s,s.deadlineAt-30000,policy).action).toBe('finish');
 expect(decideNextAction(s,at+10,{...policy,maxTurns:2}).reason).toBe('turn_budget');
 expect(decideNextAction(s,at+10,{...policy,maxFollowupDepth:1}).action).toBe('finish');
 expect(decideNextAction(strong('java-backend',[1,1],5),at+10,policy).difficulty).toBe(5);
});
test('new local sessions pin progression persistently while reopening does not dispatch work',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'progression-'));let host=await createLocalHost({dataDir:dir,assetsRoot:process.cwd()});
 try{
  for(const roleId of ['java-backend','web-frontend'] as const){
   const c=host.command('session.create',{operationId:'create-'+roleId,roleId,goal:'递进',durationMinutes:20});await host.wait(c.jobId);
   expect(host.job(c.jobId).status).toBe('completed');
  }
  await host.close();
  const {readdir}=await import('node:fs/promises');
  const files=await readdir(dir,{recursive:true});const file=files.find(f=>f.endsWith('profile.sqlite'));
  expect(file).toBeDefined();
  const db=new Database(join(dir,file!),{readonly:true});
  try{const sessions=db.query('SELECT workflow FROM local_sessions').all() as {workflow:string}[];
   for(const s of sessions)expect(JSON.parse(s.workflow).policy.parameters.difficultyProgression).toBe('independent-evidence-v1');
  }finally{db.close();}
  host=await createLocalHost({dataDir:dir,assetsRoot:process.cwd()});expect(host.status().executionStarts).toBe(0);
 }finally{await host.close();await rm(dir,{recursive:true,force:true});}
});
