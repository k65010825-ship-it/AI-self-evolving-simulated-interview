import {test,expect} from 'bun:test';import {runIntegratedJourney,runAbstentionJourney} from '../experiments/local-runtime/integrated-journey.ts';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Database} from 'bun:sqlite';
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: mixed journey retains early knowledge-gap finding rather than claiming complete experience`,async()=>{
 const result=await runIntegratedJourney(roleId);
 expect(result).toMatchObject({roleId,status:'completed-with-experience-findings',experienceStatus:'needs-improvement',askedQuestions:2,scoredAnswers:2,unscoredAnswers:0,
  independentQuestions:1,hintReceipts:2,memoryObservations:2,recalledObservations:2,recalledIndependentQuestions:1,
  speechAnswers:1,idempotencyPreserved:true,eventReplayPreserved:true,liveModelCalls:0,liveAsrCalls:0,productionRepositoryVerified:false});
 expect(new Set(result.questions.map(q=>q.id)).size).toBe(2);expect(result.questions.every(q=>q.reviewStatus==='draft')).toBe(true);
 expect(result.finding).toMatchObject({code:'PLANNED_SKILL_DEPLETED_WITHOUT_FALLBACK',reason:'knowledge_gap'});expect(result.finding.remainingOtherSkillQuestions).toBeGreaterThan(0);
 expect(result.httpEvidence).toEqual({modelHttpAttempts:0,speechHttpAttempts:0,instances:3,deniedNetworkAttempts:0});
},30000);
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: separate fresh-profile abstention closes with null score and no fabricated memory`,async()=>{
 expect(await runAbstentionJourney(roleId)).toMatchObject({roleId,status:'passed-offline-abstention',scoredAnswers:0,unscoredAnswers:1,memoryVersion:0,normalizedScore:null,liveModelCalls:0});
},15000);
test('failed synthetic journey keeps profile, committed job and measured counters for diagnosis',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'journey-evidence-'));
 try{const failure=await runIntegratedJourney('java-backend',{evidenceDir:dir,failAfterNormalAnswer:true}).then(()=>null,e=>(e as Error).message);
  expect(failure).toBe('JOURNEY_SYNTHETIC_CUT');
  expect(JSON.parse(await readFile(join(dir,'failure.json'),'utf8'))).toMatchObject({synthetic:true,productionEligible:false,errorCode:'JOURNEY_SYNTHETIC_CUT'});
  expect(JSON.parse(await readFile(join(dir,'http-evidence.json'),'utf8'))).toEqual({modelHttpAttempts:0,speechHttpAttempts:0,instances:1,deniedNetworkAttempts:0});
  const db=new Database(join(dir,'synthetic-profile','agent','profiles','default','profile.sqlite'),{readonly:true});
  try{expect(db.query("SELECT status FROM local_jobs WHERE operation_id='normal'").get()).toEqual({status:'completed'});}finally{db.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
},15000);
