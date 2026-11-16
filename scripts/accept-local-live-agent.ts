import {mkdir,mkdtemp,copyFile,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';
import {canonical,contentHash} from '../evals/answers/validation.ts';
import cfg from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};

const secret='synthetic-stdio-private-key-do-not-store';
const limits={maxCalls:6,maxTotalTokens:100000,maxCostMicros:1000000};
const config={...cfg,profile:{...cfg.profile,limits:{...cfg.profile.limits,...limits}},planning:'pi-knowledge',questionDelivery:'canonical'};
function requireCheck(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
async function dataFiles(root:string):Promise<string[]>{const files:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())files.push(...await dataFiles(path));else files.push(path);}return files;}
/** Explicitly test-only bundle; never used by the production buildLocalAgent path. */
export async function buildInjectedLocalLiveAgent(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('LOCAL_BUILD_PLATFORM_UNSUPPORTED');
 const root=resolve('.cache/local-live-injected-build');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'injected-test-only-'));const assetsRoot=join(output,'assets');await mkdir(assetsRoot);
 const result=await Bun.build({entrypoints:[resolve('experiments/local-runtime/live-fixture.ts')],outdir:output,target:'bun',format:'esm',naming:'injected-runtime.js',minify:false});requireCheck(result.success,'LOCAL_INJECTED_BUILD_FAILED');
 const executable=join(output,'bun.exe'),entry=join(output,'injected-runtime.js');await copyFile(resolve('node_modules/@oven/bun-windows-x64/bin/bun.exe'),executable);
 const files=[];for(const name of ['injected-runtime.js','bun.exe'])files.push({name,sha256:createHash('sha256').update(await readFile(join(output,name))).digest('hex')});
 const manifest={version:1,purpose:'injected-test-only',distribution:'non-production',productionEligible:false,protocolVersion:1,profileSchemaVersion:3,bunVersion:Bun.version,syntheticCredentialFixture:true,realNetworkDisabled:true,knowledge:'embedded-versioned-development-seed',files};
 await writeFile(join(assetsRoot,'manifest.json'),JSON.stringify({...manifest,digest:contentHash(manifest)},null,2)+'\n',{flag:'wx'});
 return{output,entry,executable,assetsRoot,manifest};
}
export async function acceptLocalLiveAgent(){
 const sourceManifest=await collectDeliverySources(process.cwd()),artifact=await buildInjectedLocalLiveAgent();
 const root=resolve('.cache/local-live-injected-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-')),dataDir=join(output,'合成用户数据'),cwd=join(output,'独立工作目录');await mkdir(cwd);
 const publicFrames:unknown[]=[],cases:{roleId:string;sessionId:string;callsConsumed:number;restored:boolean;completed:boolean}[]=[];let resolverCalls=0;
 const connect=()=>spawnLocalAgent({executable:artifact.executable,entry:artifact.entry,assetsRoot:artifact.assetsRoot,dataDir,cwd,resolveCredential:async()=>{resolverCalls++;return secret;}});let client=await connect();
 const request=async(method:Parameters<typeof client.request>[0],params:unknown)=>{const value=await client.request(method,params);publicFrames.push(value);return value;};
 const run=async(method:Parameters<typeof client.request>[0],params:unknown)=>{const result=await request(method,params)as {jobId:string;sessionId:string},job=await client.waitForJob(result.jobId)as {status:string};publicFrames.push(job);requireCheck(job.status==='completed','LOCAL_INJECTED_JOB_FAILED');publicFrames.push(await request('job.events',{jobId:result.jobId,afterSeq:0}));return result;};
 const httpAudit=async()=>{try{return(await readFile(join(dataDir,'fixture-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)as {kind:string;synthetic:boolean});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}};
 try{
  await request('runtime.initialize',{});client.subscribe(event=>publicFrames.push(event));
  for(const roleId of ['java-backend','web-frontend']){
   const before=(await httpAudit()).length,created=await run('session.create',{operationId:'create-'+roleId,roleId,goal:'合成随包live链路验收',durationMinutes:20,mode:'live',liveConfig:config,sessionBudget:limits});requireCheck((await httpAudit()).length===before,'LOCAL_CREATE_UNEXPECTED_HTTP');
   await request('live.authorize',{sessionId:created.sessionId,grantId:'grant-'+roleId,credentialRef:'synthetic-model-key',expectedVersion:0,expiresAt:Date.now()+60000,profile:config.profile});
   await run('session.nextQuestion',{sessionId:created.sessionId,operationId:'plan-'+roleId,expectedRevision:0});
   await run('session.answer',{sessionId:created.sessionId,operationId:'answer-'+roleId,expectedRevision:1,text:'合成答案：我会明确状态边界，验证失败处理和恢复条件。'});
   const session=await request('session.get',{sessionId:created.sessionId})as {mode:string;revision:number;answeredCount:number};requireCheck(session.mode==='live'&&session.revision===2&&session.answeredCount===1,'LOCAL_INJECTED_SESSION_INVALID');
   const budget=await request('live.budget',{sessionId:created.sessionId})as {totals:{callsConsumed:number}};requireCheck(budget.totals.callsConsumed===3,'LOCAL_INJECTED_BUDGET_INVALID');cases.push({roleId,sessionId:created.sessionId,callsConsumed:budget.totals.callsConsumed,restored:false,completed:false});
  }
  requireCheck((await httpAudit()).length===6&&resolverCalls===4,'LOCAL_INJECTED_COUNT_INVALID');await client.close();const keysBeforeRestart=resolverCalls;client=await connect();await request('runtime.initialize',{});client.subscribe(event=>publicFrames.push(event));
  for(const c of cases){const budget=await request('live.budget',{sessionId:c.sessionId})as {totals:{callsConsumed:number}};requireCheck(budget.totals.callsConsumed===c.callsConsumed,'LOCAL_INJECTED_BUDGET_RESTORE_FAILED');c.restored=true;
   await run('session.complete',{sessionId:c.sessionId,operationId:'finish-'+c.roleId,expectedRevision:2});const view=await request('session.get',{sessionId:c.sessionId})as {phase:string};requireCheck(view.phase==='completed','LOCAL_INJECTED_FINISH_FAILED');c.completed=true;
  }
  const runtimeStatus=await request('runtime.status',{})as {modelHttpAttempts:number};requireCheck(runtimeStatus.modelHttpAttempts===0&&resolverCalls===keysBeforeRestart,'LOCAL_INJECTED_RESTART_REPLAYED');const audit=await httpAudit();requireCheck(audit.length===6&&audit.every(a=>a.synthetic===true),'LOCAL_INJECTED_HTTP_INVALID');await client.close();
  requireCheck(!JSON.stringify(publicFrames).includes(secret),'LOCAL_INJECTED_PUBLIC_SECRET');const scanned=await dataFiles(dataDir);for(const file of scanned)requireCheck(!(await readFile(file)).includes(Buffer.from(secret)),'LOCAL_INJECTED_PERSISTED_SECRET');
  requireCheck(canonical(sourceManifest)===canonical(await collectDeliverySources(process.cwd())),'LOCAL_SOURCE_CHANGED');
  const body={version:1,status:'passed-injected-test-only-local-live',purpose:'injected-test-only',distribution:'non-production',productionEligible:false,artifact,cases,dataDir,cwd,runtimeStatus,sourceManifest,sourceDigest:contentHash(sourceManifest),syntheticHttpCalls:audit.length,httpAudit:audit,resolverCalls,liveModelCalls:0,restartAutomaticRequests:0,
   secretScan:{scope:['public-rpc-responses','public-event-subscriptions','all-synthetic-profile-files'],filesScanned:scanned.length,passed:true,fixtureContainsOnlySyntheticCredential:true},
   qualityClaimEligible:false,humanReferenceCount:0,realProviderVerified:false,credentialVaultVerified:false,desktopInstallerVerified:false,speechMigrated:false,limitations:['Injected HTTP exercises the real Pi SDK and private stdio protocol only.','The resolver is synthetic; no operating-system credential vault has been integrated or verified.','No real model calls, real-user answers, semantic quality, teaching improvement, or supplier bill reconciliation were verified.']};
  const reportPath=join(output,'report.json');await writeFile(reportPath,JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});return{output,reportPath,artifact:artifact.output,status:body.status,cases:cases.length,syntheticHttpCalls:audit.length,liveModelCalls:0};
 }finally{await client.close();}
}
if(import.meta.main){try{console.log(JSON.stringify(await acceptLocalLiveAgent()));}catch(e){console.error(e instanceof Error&&e.message==='LOCAL_SOURCE_CHANGED'?'LOCAL_SOURCE_CHANGED':'LOCAL_INJECTED_ACCEPTANCE_FAILED');process.exitCode=1;}}
