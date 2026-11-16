import {mkdir,mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Database} from 'bun:sqlite';
import {spawnLocalAgent} from '../../packages/local-agent-client/src/index.ts';
import {collectDeliverySources} from '../delivery/sources.ts';
import {canonical,contentHash} from '../answers/validation.ts';
import {liveConfig,limits,speechPolicy,profileFiles} from '../../tests/helpers/local-speech-config.ts';
import {makeSpeechFixture} from '../../experiments/speech/fixture.ts';
export const drillScenarios=['missing-credential','asr-429','asr-timeout','cancel-late','crash-after-dispatch'] as const;
export type DrillScenario=typeof drillScenarios[number];
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const secrets={llm:'synthetic-drill-llm-private',asr:'synthetic-drill-asr-private'};
async function audit(dataDir:string):Promise<{capability:string;kind:string;synthetic:boolean}[]>{try{return(await readFile(join(dataDir,'drill-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}}
async function until(fn:()=>Promise<boolean>){const end=Date.now()+8000;while(!await fn()){if(Date.now()>end)throw Error('DRILL_OBSERVATION_TIMEOUT');await pause(5);}}
export async function buildLocalAcceptanceDrillArtifact(output:string){
 const root=join(output,'injected-test-only-artifact'),assetsRoot=join(root,'assets');await mkdir(assetsRoot,{recursive:true});
 const executable=join(root,process.platform==='win32'?'bun.exe':'bun');
 await copyFile(process.platform==='win32'?resolve('node_modules/@oven/bun-windows-x64/bin/bun.exe'):process.execPath,executable);
 const entries:Record<string,string>={};
 for(const scenario of [...drillScenarios,'recover']){
  const name='drill-'+scenario+'.js';
  const b=await Bun.build({entrypoints:[resolve('experiments/local-acceptance/drill-runtime.ts')],outdir:root,target:'bun',format:'esm',naming:name,define:{LOCAL_ACCEPTANCE_SCENARIO:JSON.stringify(scenario)}});
  if(!b.success)throw Error('DRILL_BUILD_FAILED');entries[scenario]=join(root,name);
 }
 const files=[];for(const path of [executable,...Object.values(entries)])files.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
 const manifest={version:1,purpose:'injected-test-only',productionEligible:false,realNetworkDisabled:true,syntheticCredentials:true,files};
 await writeFile(join(assetsRoot,'manifest.json'),JSON.stringify({...manifest,digest:contentHash(manifest)},null,2)+'\n',{flag:'wx'});
 return{root,assetsRoot,executable,entries,manifest};
}
type Artifact=Awaited<ReturnType<typeof buildLocalAcceptanceDrillArtifact>>;
export type DrillCaseReport = Record<string,any> & {scenario:DrillScenario;status:'passed'|'failed';checks:{name:string;passed:boolean}[];resolverCounts:{llm:number;asr:number;recover:number}};
async function runCase(scenario:DrillScenario,output:string,artifact:Artifact):Promise<DrillCaseReport>{
 const dataDir=join(output,scenario,'profile'),cwd=join(output,scenario,'cwd');await mkdir(cwd,{recursive:true});
 const resolverCounts={llm:0,asr:0,recover:0};const frames:unknown[]=[];
 const checks:{name:string;passed:boolean}[]=[];
 const check=(name:string,passed:unknown)=>{checks.push({name,passed:!!passed});if(!passed)throw Error('DRILL_CHECK_FAILED:'+name);};
 const connect=(recover=false)=>spawnLocalAgent({executable:artifact.executable,entry:artifact.entries[recover?'recover':scenario]!,dataDir,assetsRoot:artifact.assetsRoot,cwd,resolveCredential:async binding=>{
  if(recover){resolverCounts.recover++;throw Error('DRILL_RECOVERY_CREDENTIAL_FORBIDDEN');}
  const cap=binding.credentialRef==='synthetic-drill-llm-ref'?'llm':'asr';resolverCounts[cap]++;return scenario==='missing-credential'&&cap==='asr'?undefined:secrets[cap];
 }});
 let client=await connect(),sessionId='',jobId='';
 const request=async(method:Parameters<typeof client.request>[0],params:unknown):Promise<any>=>{const v=await client.request(method,params);frames.push(v);return v;};
 const run=async(method:Parameters<typeof client.request>[0],params:unknown)=>{const v=await request(method,params);const job=await client.waitForJob(v.jobId);check(method+' completed',job.status==='completed');return v;};
 const evidence:DrillCaseReport={scenario,status:'failed',dataDir,checks,resolverCounts};
 try{
  await request('runtime.initialize',{});client.subscribe(e=>frames.push(e));
  const policy=speechPolicy();policy.asrConfig.timeoutMs=scenario==='asr-timeout'?40:2000;
  const created=await run('session.create',{operationId:'create',roleId:'java-backend',goal:'合成离线故障演练',durationMinutes:20,mode:'live',liveConfig,sessionBudget:limits,speech:policy});sessionId=created.sessionId;
  await request('live.authorize',{sessionId,grantId:'llm-grant',credentialRef:'synthetic-drill-llm-ref',expectedVersion:0,expiresAt:Date.now()+60000,profile:liveConfig.profile});
  await run('session.nextQuestion',{sessionId,operationId:'plan',expectedRevision:0});
  await request('speech.authorize',{sessionId,capability:'asr',grantId:'asr-grant',credentialRef:'synthetic-drill-asr-ref',expectedVersion:0,expiresAt:Date.now()+60000});
  const f=makeSpeechFixture('java-backend'),up=await request('speech.upload.begin',{sessionId,operationId:'upload',expectedRevision:1,byteLength:f.wavBytes.length,sha256:createHash('sha256').update(f.wavBytes).digest('hex')});
  for(let offset=0,index=0;offset<f.wavBytes.length;offset+=32768,index++)await request('speech.upload.chunk',{audioId:up.audioId,index,base64:Buffer.from(f.wavBytes.subarray(offset,offset+32768)).toString('base64')});
  await request('speech.upload.finish',{audioId:up.audioId});
  try{jobId=(await request('speech.asr.start',{operationId:'asr',audioId:up.audioId,expectedRevision:1})).jobId;}catch(e){if(scenario!=='crash-after-dispatch')throw e;}
  if(scenario==='crash-after-dispatch'){
   await until(async()=>{try{await request('runtime.status',{});return false;}catch{return true;}});await client.close();
   const db=new Database(join(dataDir,'agent','profiles','default','profile.sqlite'),{readonly:true});
   try{const row=db.query("SELECT job_id,body FROM local_speech_tasks WHERE json_extract(body,'$.kind')='asr'").get() as {job_id:string;body:string};jobId=row.job_id;evidence.beforeRecovery={task:JSON.parse(row.body),attempts:db.query('SELECT body FROM local_speech_attempts').all().map((r:any)=>JSON.parse(r.body))};check('durable dispatched checkpoint before wrapper exit',evidence.beforeRecovery.attempts[0]?.status==='dispatched');}finally{db.close();}
   await pause(2050);client=await connect(true);await request('runtime.initialize',{});
   evidence.recoveryStatus=await request('runtime.status',{});check('recovery performs no credentials or HTTP',resolverCounts.recover===0&&evidence.recoveryStatus.modelHttpAttempts===0&&evidence.recoveryStatus.speechHttpAttempts===0&&evidence.recoveryStatus.executionStarts===0);
  }else{
   if(scenario==='cancel-late'){
    await until(async()=>(await audit(dataDir)).some(a=>a.capability==='asr'));
    await request('job.cancel',{jobId});await pause(20);evidence.duringCancellation=await request('runtime.status',{});
    check('cancelled worker retains physical execution slot',evidence.duringCancellation.activeJobs===1&&evidence.duringCancellation.unknownAttempts===1);
    await until(async()=>(await request('runtime.status',{})).activeJobs===0);
    check('valid late response physically settled',(await audit(dataDir)).some(a=>a.capability==='asr-settlement'));
   }else await client.waitForJob(jobId);
  }
  evidence.job=await request('job.get',{jobId});evidence.task=await request('speech.task.get',{jobId});evidence.budget=await request('speech.budget',{sessionId});evidence.modelBudget=await request('live.budget',{sessionId});evidence.runtimeStatus=await request('runtime.status',{});
  evidence.events=await request('job.events',{jobId,afterSeq:0});evidence.session=await request('session.get',{sessionId});
  check('no transcript or formal answer published',!evidence.task.transcript&&evidence.session.answeredCount===0&&evidence.session.revision===1&&!evidence.events.some((e:any)=>e.status==='completed'));
  const attempts=evidence.budget.attempts;
  if(scenario==='missing-credential'){check('missing credential fails before ASR reservation',evidence.job.status==='failed'&&attempts.length===0&&evidence.budget.asr.heldCostMicros===0);}
  else if(scenario==='asr-429')check('429 rejected retains cost hold',evidence.job.status==='failed'&&attempts.length===1&&attempts[0].status==='rejected'&&attempts[0].httpStatus===429&&evidence.budget.asr.heldCostMicros===100000);
  else{check('uncertain attempt retains unknown cost hold',attempts.length===1&&attempts[0].status==='unknown'&&evidence.budget.asr.heldCostMicros===100000);check('terminal job reflects fault',evidence.job.status===(scenario==='cancel-late'?'cancelled':scenario==='crash-after-dispatch'?'interrupted':'failed'));
   let code='';try{await request('session.answer',{sessionId,operationId:'blocked-answer',expectedRevision:1,text:'合成测试未知账目应阻断付费评分。'});}catch(e){code=(e as Error).message;}check('unknown blocks additional paid work',code==='BUDGET_RECONCILIATION_REQUIRED');}
  await client.close();
  const http=await audit(dataDir);evidence.httpAudit=http;evidence.syntheticHTTPCounters={llm:http.filter(a=>a.capability==='llm').length,asr:http.filter(a=>a.capability==='asr').length,tts:0};
  check('exactly two synthetic Pi HTTP and no ASR retry',evidence.syntheticHTTPCounters.llm===2&&evidence.syntheticHTTPCounters.asr===(scenario==='missing-credential'?0:1)&&http.every(a=>a.synthetic));
  const files=await profileFiles(dataDir);for(const secret of Object.values(secrets)){check('no private credential in public frames',!JSON.stringify(frames).includes(secret));for(const file of files)check('no private credential persisted',!(await readFile(file)).includes(Buffer.from(secret)));}
  evidence.status='passed';
 }catch(e){evidence.status='failed';evidence.errorCode=(e as Error).message.replace(/[^A-Za-z0-9_: .-]/g,'').slice(0,200);}finally{
  try{await client.close();}catch{evidence.status='failed';evidence.closeError='DRILL_SHUTDOWN_INCOMPLETE';}
  // Failure reports retain actual counters too; an early failure is never reported as zero HTTP.
  const http=await audit(dataDir);evidence.httpAudit=http;evidence.syntheticHTTPCounters={llm:http.filter(a=>a.capability==='llm').length,asr:http.filter(a=>a.capability==='asr').length,tts:0};
 }
 return{...evidence,liveCalls:0,liveModelCalls:0,liveAsrCalls:0,liveTtsCalls:0,qualityClaimEligible:false,humanReferenceCount:0};
}
/** Offline fault evidence only. Every case owns a real SQLite profile and stdio sidecar. */
export async function runLocalAcceptanceDrills(options:{outputRoot?:string;scenarios?:readonly DrillScenario[]}={}){
 const scenarios=options.scenarios??drillScenarios;
 if(!scenarios.length||new Set(scenarios).size!==scenarios.length||scenarios.some(s=>!drillScenarios.includes(s)))throw Error('DRILL_SCENARIOS_INVALID');
 const root=resolve(options.outputRoot??'.cache/local-acceptance-drills');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 const sourceManifest=await collectDeliverySources(process.cwd());const artifact=await buildLocalAcceptanceDrillArtifact(output);
 const cases=[];for(const scenario of scenarios)cases.push(await runCase(scenario,output,artifact));
 const sourceStable=canonical(sourceManifest)===canonical(await collectDeliverySources(process.cwd()));
 const body={version:1,sourceStable,status:sourceStable&&cases.every(c=>c.status==='passed')?'passed-injected-test-only':'failed',purpose:'injected-test-only',productionEligible:false,sourceManifest,sourceDigest:contentHash(sourceManifest),artifact,cases,
  syntheticHTTPCounters:cases.reduce((n,c)=>({llm:n.llm+(c.syntheticHTTPCounters?.llm??0),asr:n.asr+(c.syntheticHTTPCounters?.asr??0),tts:0}),{llm:0,asr:0,tts:0}),
  liveCalls:0,liveModelCalls:0,liveAsrCalls:0,liveTtsCalls:0,realCredentialReads:0,qualityClaimEligible:false,humanReferenceCount:0,vendorBillingVerified:false,
  limitations:['Injected HTTP only; no real supplier request or real key access.','Dispatch-wrapper crash proves durable recovery, not supplier receipt.','Unknown and rejected cost holds are conservative local declarations, not vendor bills.','Synthetic audio and late valid transcription do not prove ASR quality, real-user performance or desktop delivery.']};
 const report={...body,digest:contentHash(body)},reportPath=join(output,'report.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return{output,report,reportPath};
}
