import {Database} from 'bun:sqlite';
import {LocalAcceptanceAuthorizationSchema} from '../../packages/contracts/src/local-acceptance.ts';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';import {join,resolve} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {spawnLocalAgent,LocalAgentClientError} from '../../packages/local-agent-client/src/index.ts';
import {readLocalAcceptance,readLocalAcceptanceForRecovery,createLocalAcceptanceAuthorization,claimLocalAcceptance,assertLocalAcceptancePath,type LocalAcceptanceBatch} from './batch.ts';
import {contentHash,canonical} from '../answers/validation.ts';
import {readJobDiagnostics} from './diagnostics.ts';
import type {EvaluationDiagnostic} from '../../packages/contracts/src/evaluation-diagnostic.ts';
type Client=Awaited<ReturnType<typeof spawnLocalAgent>>;
type Sources=()=>Promise<{path:string;sha256:string}[]>;
type Job={jobId:string;sessionId:string;status:string;errorCode:string|null};
type Row={roleId:string;sessionId:string;status:'running'|'completed'|'failed';jobs:{method:string;jobId:string;status:string;errorCode:string|null;diagnostics:EvaluationDiagnostic[];diagnosticCapture:'recorded'|'none'|'unavailable'}[];revision:number|null};
const fail=(code:string):never=>{throw Error(code);};
const safeCode=(error:unknown)=>error instanceof LocalAgentClientError&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:error instanceof Error&&/^LOCAL_ACCEPTANCE_[A-Z_]+$/.test(error.message)?error.message:'LOCAL_ACCEPTANCE_FAILED';
async function exclusiveJson(path:string,value:unknown){await assertLocalAcceptancePath(path);await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
const runtimePaths=(batch:LocalAcceptanceBatch)=>({executable:batch.artifact.executable,entry:batch.artifact.entry,assetsRoot:batch.artifact.assetsRoot,dataDir:join(batch.path,'profile'),cwd:batch.path});
export async function executeLocalAcceptance(path:string,authorization:unknown,dependencies:{resolveCredential?:Parameters<typeof spawnLocalAgent>[0]['resolveCredential'];spawn?:typeof spawnLocalAgent;sources?:Sources;now?:()=>number}={},options:{execute?:boolean;mode?:'live'|'injected-test-only'}={}){
 if(options.execute!==true)fail('LOCAL_ACCEPTANCE_EXECUTE_REQUIRED');const mode=options.mode??'live',clock=dependencies.now??Date.now;
 const batch=await readLocalAcceptance(path,dependencies.sources?{sources:dependencies.sources}:{});
 const claim=await claimLocalAcceptance(path,batch,authorization,{mode,...(dependencies.sources?{sources:dependencies.sources}:{}),now:clock});
 const auth=claim.authorization;let client:Client|undefined,runtimeStatus:Record<string,number>|null=null,stoppedForAccounting=false,errorCode:string|null=null;
 const cases:Row[]=[],budgets:{sessionId:string;model:unknown;speech:unknown|null}[]=[];let credentialRequests=0,closed=false;
 const check=()=>{if(clock()>=auth.expiresAt)fail('LOCAL_ACCEPTANCE_AUTHORIZATION_EXPIRED');};
 const request=async(method:Parameters<Client['request']>[0],params:unknown)=>{check();return client!.request(method,params);};
 async function collect(){if(!client||closed)return;try{runtimeStatus=await client.request('runtime.status',{})as Record<string,number>;stoppedForAccounting=(runtimeStatus.unknownAttempts??0)>0;}catch{runtimeStatus=null;}
  budgets.length=0;for(const row of cases)try{const model=await client.request('live.budget',{sessionId:row.sessionId}),speech=batch.mode==='speech'?await client.request('speech.budget',{sessionId:row.sessionId}):null;budgets.push({sessionId:row.sessionId,model,speech});}catch{/* an unavailable process needs explicit recovery */}}
 async function diagnostics(jobId:string){try{return await readJobDiagnostics(jobId,afterSeq=>client!.request('job.events',{jobId,afterSeq}));}catch{return{diagnostics:[] as EvaluationDiagnostic[],diagnosticCapture:'unavailable' as const};}}
 async function run(row:Row,method:Parameters<Client['request']>[0],params:unknown){const accepted=await request(method,params)as {jobId:string;sessionId:string};const done=await client!.waitForJob(accepted.jobId)as Job;row.jobs.push({method,jobId:done.jobId,status:done.status,errorCode:done.errorCode,...await diagnostics(done.jobId)});if(done.status!=='completed'){await collect();fail(stoppedForAccounting?'LOCAL_ACCEPTANCE_ACCOUNTING_BLOCKED':'LOCAL_ACCEPTANCE_JOB_FAILED');}return accepted;}
 try{
  check();const dataDir=runtimePaths(batch).dataDir;await assertLocalAcceptancePath(dataDir);await mkdir(dataDir);await exclusiveJson(join(dataDir,'acceptance-owner.json'),{version:1,batchId:batch.id,batchDigest:batch.digest,authorizationDigest:claim.authorizationDigest});
  client=await(dependencies.spawn??spawnLocalAgent)({...runtimePaths(batch),resolveCredential:async context=>{check();const binding=batch.credentials.find(c=>c.credentialRef===context.credentialRef);if(!binding)fail('LOCAL_ACCEPTANCE_CREDENTIAL_SCOPE');credentialRequests++;return dependencies.resolveCredential?.(context);}});
  const ready=await request('runtime.initialize',{})as {capabilities:string[]};if(!ready.capabilities.includes('credential-broker-v1')||batch.mode==='speech'&&!ready.capabilities.includes('local-speech-v1'))fail('LOCAL_ACCEPTANCE_CAPABILITY_MISSING');
  for(const sample of batch.samples){check();await collect();if(stoppedForAccounting)fail('LOCAL_ACCEPTANCE_ACCOUNTING_BLOCKED');
   const created=await request('session.create',{operationId:'accept-create-'+sample.roleId,roleId:sample.roleId,goal:'本地技术链路验收（来源已冻结，非评分质量金标）',durationMinutes:20,mode:'live',liveConfig:batch.liveConfig,sessionBudget:batch.sessionBudget,...(batch.speechPolicy?{speech:batch.speechPolicy}:{})})as {jobId:string;sessionId:string};
   const row:Row={roleId:sample.roleId,sessionId:created.sessionId,status:'running',jobs:[],revision:null};cases.push(row);const create=await client.waitForJob(created.jobId)as Job;row.jobs.push({method:'session.create',jobId:create.jobId,status:create.status,errorCode:create.errorCode,...await diagnostics(create.jobId)});if(create.status!=='completed')fail('LOCAL_ACCEPTANCE_JOB_FAILED');
   await request('live.authorize',{grantId:'accept-llm-'+sample.roleId,sessionId:row.sessionId,credentialRef:'acceptance-llm',expectedVersion:0,expiresAt:Math.min(auth.expiresAt,clock()+19*60000),profile:batch.liveConfig.profile});
   await run(row,'session.nextQuestion',{operationId:'accept-plan-'+sample.roleId,sessionId:row.sessionId,expectedRevision:0});
   if(batch.mode==='speech'){
    for(const capability of ['asr','tts']as const)await request('speech.authorize',{grantId:'accept-'+capability+'-'+sample.roleId,sessionId:row.sessionId,capability,credentialRef:'acceptance-'+capability,expectedVersion:0,expiresAt:Math.min(auth.expiresAt,clock()+19*60000)});
    const file=join(batch.path,sample.audio!.path);await assertLocalAcceptancePath(file);const bytes=await readFile(file);if(bytes.length!==sample.audio!.bytes||createHash('sha256').update(bytes).digest('hex')!==sample.audio!.sha256)fail('LOCAL_ACCEPTANCE_INPUT_CHANGED');
    const upload=await request('speech.upload.begin',{operationId:'accept-upload-'+sample.roleId,sessionId:row.sessionId,expectedRevision:1,byteLength:bytes.length,sha256:sample.audio!.sha256})as {audioId:string};
    for(let at=0,index=0;at<bytes.length;at+=32768,index++)await request('speech.upload.chunk',{audioId:upload.audioId,index,base64:bytes.subarray(at,at+32768).toString('base64')});
    await request('speech.upload.finish',{audioId:upload.audioId});const asr=await run(row,'speech.asr.start',{operationId:'accept-asr-'+sample.roleId,audioId:upload.audioId,expectedRevision:1});
    const transcript=await request('speech.task.get',{jobId:asr.jobId})as {status:string;version:number};if(transcript.status!=='transcribed')fail('LOCAL_ACCEPTANCE_TRANSCRIPT_MISSING');
    const tts=await run(row,'speech.tts.start',{operationId:'accept-tts-'+sample.roleId,sessionId:row.sessionId,expectedRevision:1});let offset=0;
    for(;;){const audio=await request('speech.audio.read',{jobId:tts.jobId,offset})as {base64:string;nextOffset:number;eof:boolean;sampleRate:number};const length=Buffer.from(audio.base64,'base64').length;if(audio.sampleRate!==24000||audio.nextOffset!==offset+length||length<1||length>32768||audio.nextOffset>8388608)fail('LOCAL_ACCEPTANCE_AUDIO_INVALID');offset=audio.nextOffset;if(audio.eof)break;}
    await request('speech.audio.release',{jobId:tts.jobId});await run(row,'speech.confirm',{operationId:'accept-confirm-'+sample.roleId,jobId:asr.jobId,expectedVersion:transcript.version,expectedRevision:1,text:sample.answerText});
   }else await run(row,'session.answer',{operationId:'accept-answer-'+sample.roleId,sessionId:row.sessionId,expectedRevision:1,text:sample.answerText});
   const view=await request('session.get',{sessionId:row.sessionId})as {revision:number;answeredCount:number};row.revision=view.revision;
   // A valid clarification/abstention is recorded, but does not pass this full scored-answer smoke case.
   if(view.revision!==2||view.answeredCount!==1)fail('LOCAL_ACCEPTANCE_ANSWER_UNSCORED');await run(row,'session.complete',{operationId:'accept-complete-'+sample.roleId,sessionId:row.sessionId,expectedRevision:2});row.status='completed';
  }
  await collect();if(stoppedForAccounting)fail('LOCAL_ACCEPTANCE_ACCOUNTING_BLOCKED');const observedStatus=runtimeStatus as Record<string,number>|null,attempts=observedStatus?(observedStatus.modelHttpAttempts??0)+(observedStatus.speechHttpAttempts??0):null;if(attempts===null||attempts>batch.maxRequests)fail('LOCAL_ACCEPTANCE_REQUEST_LIMIT');
  await readLocalAcceptance(path,dependencies.sources?{sources:dependencies.sources}:{});
 }catch(error){errorCode=safeCode(error);for(const row of cases)if(row.status==='running')row.status='failed';await collect();}
 finally{if(client)try{await client.close();closed=true;}catch{errorCode??='LOCAL_ACCEPTANCE_SHUTDOWN_INCOMPLETE';}}
 const observed=runtimeStatus?(runtimeStatus.modelHttpAttempts??0)+(runtimeStatus.speechHttpAttempts??0):client?null:0;
 const body={version:1,kind:mode==='live'?'local-online-acceptance':'injected-test-only-local-acceptance',batchId:batch.id,batchDigest:batch.digest,authorizationDigest:claim.authorizationDigest,
  status:errorCode?(stoppedForAccounting?'stopped-for-accounting':'failed'):'passed-technical-acceptance',errorCode,cases,budgets,runtimeStatus,credentialRequests,stoppedForAccounting,accountingUncertain:!!client&&!runtimeStatus,
  maxRequests:batch.maxRequests,maxDeclaredCostMicros:batch.maxCostMicros,observedHttpAttempts:observed,liveHttpAttempts:mode==='live'?observed:0,syntheticHttpAttempts:mode==='injected-test-only'?observed:0,
  sampleOrigins:batch.samples.map(s=>({roleId:s.roleId,origin:s.origin,audioSha256:s.audio?.sha256??null})),humanReferenceCount:0,qualityClaimEligible:false,realUserAnswerVerified:false,vendorBillingVerified:false,credentialVaultVerified:false,desktopInstallerVerified:false,
  finishedAt:clock(),limitations:['Only technical transport, state and declared budgets are checked.','No independent answer/recognition quality or vendor bill is verified.','Failure does not authorize retry, new quota, or release of unknown consumption.']};
 const report={...body,digest:contentHash(body)};await exclusiveJson(join(batch.path,'report.json'),report);return{output:batch.path,report,reportPath:join(batch.path,'report.json')};
}
export async function recoverLocalAcceptance(path:string,dependencies:{spawn?:typeof spawnLocalAgent;sources?:Sources}={}){
 const {batch,sourceCurrent}=await readLocalAcceptanceForRecovery(path);await assertLocalAcceptancePath(join(batch.path,'execution.json'));const claim=JSON.parse(await readFile(join(batch.path,'execution.json'),'utf8')),auth=LocalAcceptanceAuthorizationSchema.parse(claim.authorization);if(claim.batchDigest!==batch.digest||claim.batchId!==batch.id||claim.authorizationDigest!==contentHash(auth)||claim.kind!==auth.kind||auth.kind!==(batch.artifact.kind==='production'?'live':'injected-test-only')||canonical(auth)!==canonical(createLocalAcceptanceAuthorization(batch,{kind:auth.kind,expiresAt:auth.expiresAt})))fail('LOCAL_ACCEPTANCE_CLAIM_MISMATCH');
 const ownerPath=join(batch.path,'profile','acceptance-owner.json');await assertLocalAcceptancePath(ownerPath);const owner=JSON.parse(await readFile(ownerPath,'utf8'));if(canonical(owner)!==canonical({version:1,batchId:batch.id,batchDigest:batch.digest,authorizationDigest:claim.authorizationDigest}))fail('LOCAL_ACCEPTANCE_PROFILE_OWNER_INVALID');
 const profile=join(batch.path,'profile','agent','profiles','default','profile.sqlite');await assertLocalAcceptancePath(profile);if(!(await lstat(profile)).isFile())fail('LOCAL_ACCEPTANCE_PROFILE_MISSING');
 const manifestPath=join(batch.path,'profile','agent','profiles','default','manifest.json');await assertLocalAcceptancePath(manifestPath);let db:Database|undefined;
 try{const manifest=JSON.parse(await readFile(manifestPath,'utf8'));db=new Database(profile,{readonly:true,strict:true});const version=db.query('PRAGMA user_version').get()as {user_version:number},control=db.query('SELECT profile_id FROM local_control WHERE id=1').get()as {profile_id:string}|null;if(![3,4].includes(version.user_version)||!control||manifest.version!==1||manifest.profileId!==control.profile_id||!/^[a-f0-9-]{36}$/.test(control.profile_id))fail('LOCAL_ACCEPTANCE_PROFILE_INVALID');if((db.query('PRAGMA integrity_check').get()as {integrity_check:string}).integrity_check!=='ok')fail('LOCAL_ACCEPTANCE_PROFILE_INVALID');for(const table of ['local_sessions','local_jobs','local_events','local_memory','local_budget','local_session_budgets','local_live_grants','local_model_checkpoints','local_resource_budgets','local_speech_tasks','local_speech_attempts'])if(!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))fail('LOCAL_ACCEPTANCE_PROFILE_INVALID');}catch{fail('LOCAL_ACCEPTANCE_PROFILE_INVALID');}finally{db?.close();}

 const client=await(dependencies.spawn??spawnLocalAgent)(runtimePaths(batch));try{await client.request('runtime.initialize',{});const sessions=await client.request('session.list',{})as {sessionId:string}[];const rows=[];
  for(const session of sessions){const model=await client.request('live.budget',{sessionId:session.sessionId}),speech=batch.mode==='speech'?await client.request('speech.budget',{sessionId:session.sessionId}):null;rows.push({sessionId:session.sessionId,model,speech});}
  const status=await client.request('runtime.status',{})as {modelHttpAttempts:number;speechHttpAttempts:number};if(status.modelHttpAttempts!==0||status.speechHttpAttempts!==0)fail('LOCAL_ACCEPTANCE_RECOVERY_DISPATCH');
  const body={version:1,kind:'local-acceptance-recovery-observation',sourceCurrent,batchId:batch.id,batchDigest:batch.digest,observedAt:Date.now(),runtimeStatus:status,rows,credentialRequests:0,liveHttpAttempts:0,qualityClaimEligible:false,vendorBillingVerified:false,originalReportUnchanged:true};const report={...body,digest:contentHash(body)},file=join(batch.path,'recovery-'+randomUUID()+'.json');await exclusiveJson(file,report);return{report,reportPath:file};
 }finally{await client.close();}
}
