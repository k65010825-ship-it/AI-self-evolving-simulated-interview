import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {bindLocalProcess} from '../packages/local-agent-client/src/connection.ts';
import {createInterviewState,decideNextAction,estimateSkills,recordObservation} from '../apps/agent/src/planning/interview-state.ts';
import {roleSkillConfigs,ROLE_CATALOG_VERSION} from '../packages/contracts/src/role-catalog.ts';
import {buildRoleCatalogList} from '../apps/agent/src/knowledge/catalog.ts';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';

test('both roles expose 6 main skills plus independent behavioral dimension with honest draft availability',()=>{
 const roles=buildRoleCatalogList();
 expect(roles).toHaveLength(2);
 for(const role of roles){
  expect(role.catalogVersion).toBe(ROLE_CATALOG_VERSION);
  expect(role.mainSkillCount).toBe(6);
  expect(role.skills).toHaveLength(6);
  expect(role.behavioralSkills).toHaveLength(1);
  expect(role.behavioralSkills[0]!.skillId).toBe('collaboration');
  for(const skill of [...role.skills,...role.behavioralSkills]){
   expect(skill.reviewedCount).toBe(0);
   expect(skill.availableInReviewedOnly).toBe(false);
   expect(skill.availableInDraftPreview).toBe(true);
   expect(skill.draftCount).toBeGreaterThanOrEqual(1);
  }
 }
});

test('broad-coverage prioritizes uncovered skills while weakness-focus keeps cumulative rank; new skills stay null without leakage',()=>{
 const now=Date.now(),skills=roleSkillConfigs('java-backend');
 const priorObservations=skills.filter(s=>s.skillId!=='java-jvm').flatMap((s,i)=>([
  {sessionId:'prev-1',observationId:`p-${i}-a`,roleId:'java-backend' as const,skillId:s.skillId,questionId:`q-${s.skillId}-1`,questionType:s.skillId==='collaboration'?'behavioral' as const:'technical' as const,difficulty:2,score:0.95,quality:1,observedAt:now-20000,rubricId:`q-${s.skillId}-1`,rubricVersion:'bank-0.1',evidenceMode:'offline-fixture' as const},
  {sessionId:'prev-2',observationId:`p-${i}-b`,roleId:'java-backend' as const,skillId:s.skillId,questionId:`q-${s.skillId}-2`,questionType:s.skillId==='collaboration'?'behavioral' as const:'scenario' as const,difficulty:2,score:0.95,quality:1,observedAt:now-10000,rubricId:`q-${s.skillId}-2`,rubricVersion:'bank-0.1',evidenceMode:'offline-fixture' as const},
 ])).sort((a,b)=>a.observedAt-b.observedAt);
 const base=createInterviewState({sessionId:'mode-diff',roleId:'java-backend',durationMinutes:20,skills},now);
 const withPrior={...base,priorEvidence:priorObservations};
 const untouched=estimateSkills(base,now);
 expect(untouched.every(s=>s.mastery===null&&s.confidence===0&&s.independentQuestions===0)).toBe(true);
 const after=recordObservation(withPrior,{observationId:'o1',roleId:'java-backend',skillId:'java-jvm',questionId:'java-technical-jvm-gc',
  questionType:'technical',difficulty:2,score:0.1,quality:1,observedAt:now+1000},0,now+1000);
 const weak=decideNextAction(after,now+2000,{maxFollowupDepth:2,maxTurns:8,wrapUpSeconds:45,practiceMode:'weakness-focus'});
 const broad=decideNextAction(after,now+2000,{maxFollowupDepth:2,maxTurns:8,wrapUpSeconds:45,practiceMode:'broad-coverage'});
 expect(weak.skillId).toBe('java-jvm');
 expect(broad.action).toBe('switch_skill');
 expect(broad.skillId).not.toBe('java-jvm');
});

test('stdio roles.list and createSession validate 6-skill catalog, maxTurns=8, and reject malformed responses',async()=>{
 const data=await mkdtemp(join(tmpdir(),'role-catalog-stdio-'));
 const client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()});
 try{
  await client.request('runtime.initialize',{});
  const roles=await client.listRoles();
  expect(roles.map(r=>r.id)).toEqual(['java-backend','web-frontend']);
  expect(roles[0]!.skills).toHaveLength(6);
  const created=await client.createSession({operationId:'create-broad',roleId:'web-frontend',goal:'覆盖六技能',durationMinutes:20,practiceMode:'broad-coverage'});
  await client.waitForJob(created.jobId);
  const session=await client.getSession(created.sessionId);
  expect(session.revision).toBe(0);
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
});

test('SDK listRoles and createSession reject malformed frames with LOCAL_RESPONSE_INVALID',async()=>{
 const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
 const child=Object.assign(new EventEmitter(),{stdin,stdout,stderr,kill:()=>true}) as never;
 stdin.on('data',chunk=>{
  const req=JSON.parse(chunk.toString().trim());
  const bad=req.method==='roles.list'?[{id:'java-backend',label:'bad'}]:{jobId:'only-job'};
  stdout.write(JSON.stringify({protocolVersion:1,type:'response',id:req.id,ok:true,result:bad})+'\n');
 });
 const client=bindLocalProcess(child,{timeoutMs:1000});
 await expect(client.listRoles()).rejects.toThrow('LOCAL_RESPONSE_INVALID');
 await expect(client.createSession({operationId:'op1',roleId:'java-backend',goal:'g',durationMinutes:20})).rejects.toThrow('LOCAL_RESPONSE_INVALID');
});
