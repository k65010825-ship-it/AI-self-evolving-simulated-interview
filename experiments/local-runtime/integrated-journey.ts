import {mkdtemp,rm,cp,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {Database} from 'bun:sqlite';
import {createLocalHost} from '../../apps/agent/src/local/host.ts';import {WorkflowSchema} from '../../packages/contracts/src/session-workflow.ts';
import {estimateSkills} from '../../apps/agent/src/planning/interview-state.ts';import {makeSpeechFixture} from '../speech/fixture.ts';
import {createSqliteHintFixture} from '../../tests/fixtures/hint-repository.ts';
import asrConfig from '../../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import javaSeed from '../../knowledge/java-backend/seed.json' with {type:'json'};import webSeed from '../../knowledge/web-frontend/seed.json' with {type:'json'};
import {AgentRunRequestSchema} from '../../packages/contracts/src/agent-run.ts';import {validateWorkflowTransition} from '../../packages/agent-client/src/commit-validation.ts';
/** Acceptance-only. Synthetic answers/audio and disposable SQLite fixture; never a production repository. */
function check(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
const failureCode=(error:unknown)=>{const code=(error as Error)?.message;return typeof code==='string'&&/^[A-Z_]{1,100}$/.test(code)?code:'JOURNEY_FAILURE';};
const speech={asrConfig,ttsConfig:{enabled:false,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'},asrBudget:{maxCalls:6,maxAudioMs:120000,maxCostMicros:1000000,reserveCostMicrosPerCall:10000},ttsBudget:{maxCalls:6,maxCharacters:6000,maxCostMicros:1000000,reserveCostMicrosPerCall:10000},totalMaxCostMicros:2000000};
type JourneyOptions={evidenceDir?:string;failAfterNormalAnswer?:boolean};
function networkGuard(){let attempts=0;return{get attempts(){return attempts;},deny:async()=>{attempts++;throw Error('JOURNEY_NETWORK_FORBIDDEN');}};}
async function preserve(dataDir:string,dir:string|undefined){if(!dir)return;await cp(dataDir,join(dir,'synthetic-profile'),{recursive:true,force:false,errorOnExist:true});}
export async function runIntegratedJourney(roleId:'java-backend'|'web-frontend',evidence:JourneyOptions={}){
 if(evidence.evidenceDir)await mkdir(evidence.evidenceDir,{recursive:true});
 const guard=networkGuard(),totals={modelHttpAttempts:0,speechHttpAttempts:0,instances:0},accounted=new WeakSet<object>();
 const dataDir=await mkdtemp(join(tmpdir(),'integrated-journey-')),port=createSqliteHintFixture(),options={dataDir,assetsRoot:process.cwd(),hints:port.repository,liveFetch:guard.deny,speechFetch:guard.deny};let host=await createLocalHost(options);
 const close=async()=>{if(accounted.has(host))return;accounted.add(host);const s=host.status();totals.modelHttpAttempts+=s.modelHttpAttempts;totals.speechHttpAttempts+=s.speechHttpAttempts;totals.instances++;await host.close();};
 const workflow=(id:string)=>{const db=new Database(join(dataDir,'agent','profiles','default','profile.sqlite'),{readonly:true});try{const row=db.query('SELECT workflow FROM local_sessions WHERE session_id=?').get(id) as {workflow:string};return WorkflowSchema.parse(JSON.parse(row.workflow));}finally{db.close();}};
 const run=async(method:Parameters<typeof host.command>[0],params:unknown)=>{const task=host.command(method,params);await host.wait(task.jobId);const job=host.job(task.jobId);check(job.status==='completed','JOURNEY_'+method.toUpperCase().replace(/\./g,'_')+'_'+(job.errorCode??job.status));return task;};
 const expectCode=(fn:()=>unknown,code:string)=>{let actual='';try{fn();}catch(e){actual=(e as {code?:string;message?:string}).code??(e as Error).message;}check(actual===code,'JOURNEY_EXPECTED_'+code);};
 try{
  const c=await run('session.create',{operationId:'create',roleId,goal:'合成跨模块完整会话验收',durationMinutes:20,speech});const id=c.sessionId;
  const revision=()=>host.session(id).revision;
  await run('session.nextQuestion',{operationId:'q1',sessionId:id,expectedRevision:revision()});
  await run('session.answer',{operationId:'normal',sessionId:id,expectedRevision:revision(),text:'我会先明确前提与边界，比较备选方案，并通过失败场景和重复实验验证结果。'});
  if(evidence.failAfterNormalAnswer)throw Error('JOURNEY_SYNTHETIC_CUT');
  await run('session.nextQuestion',{operationId:'q2',sessionId:id,expectedRevision:revision()});
  const status=host.hintStatus({sessionId:id});check(!!status.issueId,'JOURNEY_NO_HINT_ISSUE');
  const hint={operationId:'hint-1',sessionId:id,issueId:status.issueId,expectedRevision:revision()},firstReceipt=host.hint(hint);
  await run('session.answer',{operationId:'gap',sessionId:id,expectedRevision:revision(),text:'不懂'});
  check(host.session(id).needsClarification,'JOURNEY_MISSING_CLARIFICATION');
  await close();host=await createLocalHost(options);check(host.status().executionStarts===0,'JOURNEY_REEXECUTED_ON_RESTART');
  check(JSON.stringify(host.hint(hint))===JSON.stringify(firstReceipt),'JOURNEY_HINT_REPLAY_CHANGED');
  check(host.hintStatus({sessionId:id}).issueId===status.issueId,'JOURNEY_ISSUE_RESET');
  host.hint({...hint,operationId:'hint-2',expectedRevision:revision()});
  expectCode(()=>host.hint({...hint,operationId:'hint-3',expectedRevision:revision()}),'HINT_LIMIT_REACHED');
  const wav=makeSpeechFixture(roleId).wavBytes,upload=host.speech('speech.upload.begin',{operationId:'upload',sessionId:id,expectedRevision:revision(),byteLength:wav.length,sha256:createHash('sha256').update(wav).digest('hex')}) as {audioId:string};
  for(let offset=0,index=0;offset<wav.length;offset+=32768,index++)host.speech('speech.upload.chunk',{audioId:upload.audioId,index,base64:Buffer.from(wav.subarray(offset,offset+32768)).toString('base64')});
  host.speech('speech.upload.finish',{audioId:upload.audioId});const asr=host.speech('speech.asr.start',{operationId:'asr',audioId:upload.audioId,expectedRevision:revision()}) as {jobId:string};await host.wait(asr.jobId);
  const transcript=host.speech('speech.task.get',{jobId:asr.jobId}) as {version:number;transcript:{originalText:string}};
  const confirmation={operationId:'confirm',jobId:asr.jobId,expectedVersion:transcript.version,expectedRevision:revision(),text:'不懂；补充：'+transcript.transcript.originalText};
  const answer=host.speech('speech.confirm',confirmation) as {jobId:string};await host.wait(answer.jobId);check(host.job(answer.jobId).status==='completed','JOURNEY_SPEECH_ANSWER_FAILED');
  check((host.speech('speech.confirm',confirmation) as {jobId:string}).jobId===answer.jobId,'JOURNEY_CONFIRM_REPLAY_CHANGED');
  const assisted=host.answerPage({sessionId:id}).items.find(a=>a.assistance);check(assisted?.assistance?.receiptIds.length===2,'JOURNEY_ASSISTANCE_LOST');
  await run('session.nextQuestion',{operationId:'q3',sessionId:id,expectedRevision:revision()});
  const stopped=workflow(id),selection=stopped.lastPlan?.selection;
  check(stopped.phase==='ready_to_close'&&stopped.pendingReason==='knowledge_gap'&&selection?.status==='unavailable','JOURNEY_EXPECTED_KNOWLEDGE_FINDING_CHANGED');
  const plannedSkillId=selection.plan.skillId,seen=new Set(stopped.askedQuestionIds),skills=new Set(stopped.state.skills.filter(s=>s.relevance>0).map(s=>s.skillId));
  const remainingOtherSkillQuestions=[...javaSeed,...webSeed].filter(q=>q.roleId===roleId&&q.skillId!==plannedSkillId&&skills.has(q.skillId)&&!seen.has(q.id)).length;
  check(remainingOtherSkillQuestions>0,'JOURNEY_FINDING_NOT_SUPPORTED');
  const finishCommand={operationId:'finish',sessionId:id,expectedRevision:revision()},finished=await run('session.complete',finishCommand);
  const events=host.events(finished.jobId);check(events.at(-1)?.status==='completed','JOURNEY_MISSING_COMMIT_EVENT');
  const closed=workflow(id),report=closed.closeout!.report,memory=host.memory(roleId);
  const gateDb=new Database(join(dataDir,'agent','profiles','default','profile.sqlite'),{readonly:true});
  try{const row=gateDb.query('SELECT request FROM local_jobs WHERE job_id=?').get(finished.jobId) as {request:string};const request=AgentRunRequestSchema.parse(JSON.parse(row.request));
   check(request.job.type==='workflow','JOURNEY_INVALID_COMMIT_SOURCE');const operation=request.job.operation;validateWorkflowTransition(operation,closed,closed.closeout!.generatedAt);
   const stripped=structuredClone(closed);for(const a of stripped.closeout!.report.assessments)delete a.assistance;
   expectCode(()=>validateWorkflowTransition(operation,stripped,closed.closeout!.generatedAt),'COMMIT_TRANSITION_INVALID');
  }finally{gateDb.close();}
  check(closed.phase==='completed'&&report.coverage.totalAnswers===2&&report.assessments.length===2&&!(report.unscoredAnswers?.length),'JOURNEY_REPORT_COVERAGE');
  check(report.coverage.independentQuestions===1,'JOURNEY_ASSISTED_MASTERY_CONTAMINATION');
  check(report.expression.status==='audio_descriptions'&&report.expression.coverage.speechAnswers===1,'JOURNEY_SPEECH_SOURCE_LOST');
  check(closed.closeout!.reflection.candidate===null,'JOURNEY_ASSISTED_RSI_CANDIDATE');
  check(memory.sessions[0]?.observations.length===2&&memory.sessions[0].observations.filter(o=>o.assistance).length===1,'JOURNEY_MEMORY_PROVENANCE_LOST');
  await close();host=await createLocalHost(options);
  check(JSON.stringify(host.events(finished.jobId))===JSON.stringify(events),'JOURNEY_EVENT_REPLAY_CHANGED');
  check(host.command('session.complete',finishCommand).jobId===finished.jobId,'JOURNEY_FINISH_REPLAY_CHANGED');
  check(JSON.stringify(host.hint(hint))===JSON.stringify(firstReceipt),'JOURNEY_COMPLETED_HINT_REPLAY_CHANGED');
  const next=await run('session.create',{operationId:'next-session',roleId,goal:'合成记忆召回验收',durationMinutes:20});
  const nextWorkflow=workflow(next.sessionId),estimates=estimateSkills(nextWorkflow.state,Date.now()),independent=estimates.reduce((n,s)=>n+s.independentQuestions,0);
  check(nextWorkflow.state.priorEvidence.length===2&&independent===1,'JOURNEY_RECALL_CONTAMINATION');
  const final=host.status();check(totals.modelHttpAttempts+final.modelHttpAttempts===0&&totals.speechHttpAttempts+final.speechHttpAttempts===0&&guard.attempts===0,'JOURNEY_UNEXPECTED_HTTP');
  return{roleId,status:'completed-with-experience-findings' as const,experienceStatus:'needs-improvement' as const,
   finding:{code:'PLANNED_SKILL_DEPLETED_WITHOUT_FALLBACK' as const,reason:'knowledge_gap',plannedSkillId,remainingSeconds:selection.plan.remainingSeconds,remainingOtherSkillQuestions},
   askedQuestions:closed.askedQuestionIds.length,scoredAnswers:report.assessments.length,unscoredAnswers:report.unscoredAnswers?.length??0,independentQuestions:report.coverage.independentQuestions,
   hintReceipts:2,memoryObservations:2,recalledObservations:nextWorkflow.state.priorEvidence.length,recalledIndependentQuestions:independent,speechAnswers:1,
   idempotencyPreserved:true,eventReplayPreserved:true,liveModelCalls:0,liveAsrCalls:0,productionRepositoryVerified:false,
   questions:closed.issuedQuestions.map(q=>({id:q.questionId,rubricId:q.content!.rubric.id,rubricVersion:q.content!.rubric.version,
    criteria:q.content!.rubric.criteria.map(c=>c.id),sourceVersion:q.content!.source.version,reviewStatus:q.content!.source.reviewStatus})),
   httpEvidence:{modelHttpAttempts:totals.modelHttpAttempts+final.modelHttpAttempts,speechHttpAttempts:totals.speechHttpAttempts+final.speechHttpAttempts,instances:totals.instances+1,deniedNetworkAttempts:guard.attempts},
   evidenceMode:'synthetic-fixture',humanReferenceCount:0,qualityClaimEligible:false};
 }catch(error){if(evidence.evidenceDir)await writeFile(join(evidence.evidenceDir,'failure.json'),JSON.stringify({roleId,errorCode:failureCode(error),synthetic:true,productionEligible:false}));throw error;
 }finally{try{await close();}finally{await preserve(dataDir,evidence.evidenceDir);if(evidence.evidenceDir)await writeFile(join(evidence.evidenceDir,'http-evidence.json'),JSON.stringify({...totals,deniedNetworkAttempts:guard.attempts}));await rm(dataDir,{recursive:true,force:true});}}
}
/** Separate profile is intentional: do not pretend the short mixed session reached a third question. */
export async function runAbstentionJourney(roleId:'java-backend'|'web-frontend',evidence:JourneyOptions={}){
 if(evidence.evidenceDir)await mkdir(evidence.evidenceDir,{recursive:true});const guard=networkGuard();
 const dataDir=await mkdtemp(join(tmpdir(),'abstention-journey-')),host=await createLocalHost({dataDir,assetsRoot:process.cwd(),hints:createSqliteHintFixture().repository,liveFetch:guard.deny,speechFetch:guard.deny});
 const run=async(method:Parameters<typeof host.command>[0],params:unknown)=>{const task=host.command(method,params);await host.wait(task.jobId);check(host.job(task.jobId).status==='completed','ABSTENTION_JOB_FAILED');return task;};
 try{const c=await run('session.create',{operationId:'create',roleId,goal:'独立合成弃评场景',durationMinutes:20});const sessionId=c.sessionId,revision=()=>host.session(sessionId).revision;
  await run('session.nextQuestion',{operationId:'plan',sessionId,expectedRevision:revision()});
  const hint=host.hintStatus({sessionId});host.hint({operationId:'hint',sessionId,issueId:hint.issueId,expectedRevision:revision()});
  await run('session.answer',{operationId:'gap',sessionId,expectedRevision:revision(),text:'不懂'});check(host.session(sessionId).needsClarification,'ABSTENTION_MISSING_CLARIFICATION');
  await run('session.answer',{operationId:'abstain',sessionId,expectedRevision:revision(),text:'不懂。'});
  check(host.answerPage({sessionId}).items[0]?.status==='abstained','ABSTENTION_NOT_RECORDED');
  await run('session.complete',{operationId:'finish',sessionId,expectedRevision:revision()});
  const view=host.session(sessionId),score=host.answerPage({sessionId}).items[0]!.normalizedScore;
  check(score===null&&view.scoredCount===0&&view.unscoredCount===1&&host.memory(roleId).version===0,'ABSTENTION_FALSE_ZERO_OR_MEMORY');
  check(host.answerPage({sessionId}).items[0]?.assistance?.receiptIds.length===1,'ABSTENTION_ASSISTANCE_LOST');
  const http=host.status();check(http.modelHttpAttempts===0&&http.speechHttpAttempts===0&&guard.attempts===0,'ABSTENTION_UNEXPECTED_HTTP');
  return{roleId,status:'passed-offline-abstention' as const,assisted:true,scoredAnswers:view.scoredCount,unscoredAnswers:view.unscoredCount,memoryVersion:host.memory(roleId).version,normalizedScore:score,liveModelCalls:0};
 }catch(error){if(evidence.evidenceDir)await writeFile(join(evidence.evidenceDir,'failure.json'),JSON.stringify({roleId,errorCode:failureCode(error),synthetic:true,productionEligible:false}));throw error;
 }finally{try{const http=host.status();if(evidence.evidenceDir)await writeFile(join(evidence.evidenceDir,'http-evidence.json'),JSON.stringify({modelHttpAttempts:http.modelHttpAttempts,speechHttpAttempts:http.speechHttpAttempts,instances:1,deniedNetworkAttempts:guard.attempts}));await host.close();}
  finally{await preserve(dataDir,evidence.evidenceDir);await rm(dataDir,{recursive:true,force:true});}}
}
