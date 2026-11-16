import {mkdir,mkdtemp,readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,basename} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {LocalAcceptanceBatchSchema,LocalAcceptanceSampleSchema,LocalAcceptanceAuthorizationSchema,type LocalAcceptanceBatch,type LocalAcceptanceAuthorization} from '../../packages/contracts/src/local-acceptance.ts';
import {LiveServiceConfigSchema} from '../../packages/contracts/src/live-model.ts';
import {LocalSpeechPolicySchema} from '../../packages/contracts/src/local-speech.ts';
import example from '../../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
import {collectDeliverySources} from '../delivery/sources.ts';
import {canonical,contentHash} from '../answers/validation.ts';
import {inspectWav} from '../../apps/agent/src/speech/wav.ts';
import {buildLocalAgent} from '../../scripts/build-local-agent.ts';
export type {LocalAcceptanceBatch,LocalAcceptanceAuthorization};
type Artifact={output:string;executable:string;entry:string;assetsRoot:string};
type Sources=()=>Promise<{path:string;sha256:string}[]>;
type ReadOptions={sources?:Sources};
type Sample={roleId:'java-backend'|'web-frontend';origin:'synthetic-development'|'user-provided';answerText:string;audioPath?:string};
const invalid=():never=>{throw Error('LOCAL_ACCEPTANCE_INVALID');};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** Check every existing ancestor, including junctions, before any read or write. */
export async function assertLocalAcceptancePath(path:string){let current=resolve(path);while(true){try{const stat=await lstat(current);if(stat.isSymbolicLink())invalid();const actual=await realpath(current);if(resolve(actual).toLowerCase()!==current.toLowerCase())invalid();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const parent=dirname(current);if(parent===current)break;current=parent;}}
function contained(root:string,path:string){const rel=relative(resolve(root),resolve(path));if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))invalid();}
async function readBounded(path:string,max=16*1024*1024){await assertLocalAcceptancePath(path);const stat=await lstat(path);if(!stat.isFile()||stat.size>max)invalid();return readFile(path);}
export function localAcceptanceLiveConfig(){return LiveServiceConfigSchema.parse({...example,outputRepair:'json-fence-only',evidenceGrounding:'quoted-spans',authorization:{enabled:false,operatorApproved:false,expiresAt:0,maxRuns:3},profile:{...example.profile,profileId:'local-acceptance-v1',limits:{...example.profile.limits,maxCalls:3,maxConcurrent:1,maxInputTokens:12000,maxOutputTokens:4000,maxTotalTokens:48000,maxCostMicros:1000000,timeoutMs:30000}},recovery:{httpMaxAttempts:1,maxModelRepairs:0,maxOutputRecoveries:0,maxContextCompactions:0}});}
export function localAcceptanceSpeechPolicy(){return LocalSpeechPolicySchema.parse({asrConfig:{version:1,enabled:true,providerId:'qianwen',modelId:'qwen3.8-omni-flash',endpoint:'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY',timeoutMs:30000,maxOutputTokens:512,authorization:{allowLive:false,expiresAt:0},budget:{maxCalls:1,maxTotalAudioMs:120000,maxCostMicros:250000,reserveCostMicrosPerCall:250000}},ttsConfig:{enabled:true,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'},asrBudget:{maxCalls:1,maxAudioMs:120000,maxCostMicros:250000,reserveCostMicrosPerCall:250000},ttsBudget:{maxCalls:1,maxCharacters:1000,maxCostMicros:250000,reserveCostMicrosPerCall:250000},totalMaxCostMicros:1500000});}
function credentials(mode:'text'|'speech'){const result:LocalAcceptanceBatch['credentials']=[{credentialRef:'acceptance-llm',platform:'qianwen',env:'INTERVIEW_QIANWEN_API_KEY'}];if(mode==='speech')result.push({credentialRef:'acceptance-asr',platform:'qianwen',env:'INTERVIEW_BAILIAN_ASR_API_KEY'},{credentialRef:'acceptance-tts',platform:'qianwen',env:'INTERVIEW_BAILIAN_ASR_API_KEY'});return result;}
async function freezeArtifact(input:Artifact,kind:'production'|'injected-test-only',checkInstalledBun=true){
 const artifact:Artifact={output:input.output,executable:input.executable,entry:input.entry,assetsRoot:input.assetsRoot};
 for(const path of Object.values(artifact)){await assertLocalAcceptancePath(path);contained(artifact.output,path);}
 if(resolve(artifact.assetsRoot)!==join(resolve(artifact.output),'assets')||resolve(artifact.executable)!==join(resolve(artifact.output),'bun.exe')||dirname(resolve(artifact.entry))!==resolve(artifact.output))invalid();
 const manifestBytes=await readBounded(join(artifact.assetsRoot,'manifest.json')),manifest=JSON.parse(manifestBytes.toString('utf8')) as Record<string,unknown>;
 if(kind==='production'){if(basename(artifact.entry)!=='runtime.js'||!equal(Object.keys(manifest).sort(),['version','mode','defaultSessionMode','protocolVersion','profileSchemaVersion','knowledge','files'].sort())||manifest.version!==1||manifest.mode!=='local-runtime'||manifest.defaultSessionMode!=='offline-fixture'||manifest.protocolVersion!==1||manifest.profileSchemaVersion!==3||manifest.knowledge!=='embedded-versioned-development-seed')invalid();}
 else if(manifest.purpose!=='injected-test-only'||manifest.productionEligible!==false)invalid();
 const files=[];for(const path of [artifact.executable,artifact.entry])files.push({path:resolve(path),sha256:sha(await readBounded(path,160*1024*1024))});
 if(!Array.isArray(manifest.files)||manifest.files.length!==2||!files.every(f=>(manifest.files as {name:string;sha256:string}[]).some(m=>m.name===basename(f.path)&&m.sha256===f.sha256)))invalid();
 if(checkInstalledBun&&kind==='production'&&files[0]!.sha256!==sha(await readBounded(resolve('node_modules/@oven/bun-windows-x64/bin/bun.exe'),160*1024*1024)))invalid();
 return{...artifact,kind,manifestSha256:sha(manifestBytes),files};
}
export async function prepareLocalAcceptance(options:{mode?:'text'|'speech';samples?:Sample[];artifact?:Artifact;artifactKind?:'production'|'injected-test-only';outputRoot?:string}={},deps:{sources?:Sources;build?:()=>Promise<Artifact>}={}){
 const mode=options.mode??'text',kind=options.artifactKind??'production',sourceRoot=resolve(process.cwd()),sources=deps.sources??(()=>collectDeliverySources(sourceRoot));
 const samples=options.samples??(mode==='speech'?invalid():[{roleId:'java-backend' as const,origin:'synthetic-development' as const,answerText:'合成开发样例：我会先明确并发边界，再验证失败与恢复条件。'},{roleId:'web-frontend' as const,origin:'synthetic-development' as const,answerText:'合成开发样例：我会固定测量条件，并验证交互结果和性能变化。'}]);
 if(samples.some(s=>s.answerText.length>10000||!s.answerText.trim())||samples.length!==2||new Set(samples.map(s=>s.roleId)).size!==2||mode==='text'&&samples.some(s=>s.audioPath!==undefined)||mode==='speech'&&samples.some(s=>!s.audioPath))invalid();
 const sourceManifest=await sources(),artifact=await freezeArtifact(options.artifact??await(deps.build??buildLocalAgent)(),kind),root=resolve(options.outputRoot??'.cache/local-online-acceptance');await assertLocalAcceptancePath(root);await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'batch-'));await mkdir(join(output,'inputs'));
 const frozen:LocalAcceptanceBatch['samples']=[];for(const sample of samples){const {audioPath,...body}=sample;if(audioPath){if(basename(audioPath).startsWith('.')||!audioPath.toLowerCase().endsWith('.wav'))invalid();const bytes=await readBounded(audioPath),audio=inspectWav(bytes),path='inputs/'+sample.roleId+'.wav';await writeFile(join(output,path),bytes,{flag:'wx',mode:0o600});frozen.push({...body,audio:{path,sha256:sha(bytes),bytes:bytes.length,durationMs:audio.durationMs}});}else frozen.push(body);}
 if(!equal(sourceManifest,await sources()))invalid();const body={version:1 as const,id:randomBytes(12).toString('hex'),path:output,createdAt:Date.now(),mode,sourceRoot,sourceManifest,sourceDigest:contentHash(sourceManifest),artifact,samples:frozen.map(s=>LocalAcceptanceSampleSchema.parse(s)),liveConfig:localAcceptanceLiveConfig(),sessionBudget:{maxCalls:3 as const,maxTotalTokens:48000 as const,maxCostMicros:1000000 as const},speechPolicy:mode==='speech'?localAcceptanceSpeechPolicy():null,credentials:credentials(mode),maxRequests:mode==='speech'?10 as const:6 as const,maxCostMicros:mode==='speech'?3000000 as const:2000000 as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const};
 const batch=LocalAcceptanceBatchSchema.parse({...body,digest:contentHash(body)});await writeFile(join(output,'batch.json'),JSON.stringify(batch,null,2)+'\n',{flag:'wx',mode:0o600});await writeFile(join(output,'review.md'),`# 本地在线验收冻结批次\n\n批次 ${batch.id}\n摘要 ${batch.digest}\n模式 ${mode}；最多 ${batch.maxRequests} 请求、${batch.maxCostMicros} CNY micros 声明预算（非厂商账单）。\n\n输入来源：${frozen.map(s=>s.roleId+': '+s.origin).join('；')}。humanReferenceCount=0；qualityClaimEligible=false。\n\nprepare不读取凭证、不联网。执行需新的明确授权；同一批次只claim一次，失败不重置。SHA256仅检验一致性，不是防恶意本地修改的签名。\n`,{flag:'wx'});await writeApprovalMaterials(output,batch);return {output,batch};
}
export async function readLocalAcceptance(path:string,options:ReadOptions={}){
 const output=resolve(path),batch=LocalAcceptanceBatchSchema.parse(JSON.parse((await readBounded(join(output,'batch.json'),4*1024*1024)).toString('utf8'))),{digest,...body}=batch;
 if(resolve(batch.path)!==output||contentHash(body)!==digest||contentHash(batch.sourceManifest)!==batch.sourceDigest||!equal(batch.sourceManifest,await(options.sources??(()=>collectDeliverySources(batch.sourceRoot)))())||!equal(batch.liveConfig,localAcceptanceLiveConfig())||!equal(batch.credentials,credentials(batch.mode))||!equal(batch.speechPolicy,batch.mode==='speech'?localAcceptanceSpeechPolicy():null)||batch.maxRequests!==(batch.mode==='speech'?10:6)||batch.maxCostMicros!==(batch.mode==='speech'?3000000:2000000)||new Set(batch.samples.map(s=>s.roleId)).size!==2)invalid();
 await assertLocalAcceptancePath(batch.sourceRoot);const artifact=await freezeArtifact(batch.artifact,batch.artifact.kind);if(!equal(artifact,batch.artifact))invalid();
 if(resolve(batch.sourceRoot)!==resolve(process.cwd()))invalid();for(const sample of batch.samples){if(batch.mode==='speech'&&!sample.audio||batch.mode==='text'&&sample.audio)invalid();if(sample.audio){if(sample.audio.path!==`inputs/${sample.roleId}.wav`)invalid();const bytes=await readBounded(join(output,sample.audio.path));if(sha(bytes)!==sample.audio.sha256||bytes.length!==sample.audio.bytes||inspectWav(bytes).durationMs!==sample.audio.durationMs)invalid();}}
 return batch;
}
/** Observation only: this snapshot is never a new live execution authorization. */
export async function readLocalAcceptanceForRecovery(path:string):Promise<{batch:LocalAcceptanceBatch;sourceCurrent:boolean}>{
 const output=resolve(path),batch=LocalAcceptanceBatchSchema.parse(JSON.parse((await readBounded(join(output,'batch.json'),4*1024*1024)).toString('utf8'))),{digest,...body}=batch;
 if(resolve(batch.path)!==output||contentHash(body)!==digest||contentHash(batch.sourceManifest)!==batch.sourceDigest)invalid();
 await assertLocalAcceptancePath(batch.sourceRoot);
 const artifact=await freezeArtifact(batch.artifact,batch.artifact.kind,false);if(!equal(artifact,batch.artifact))invalid();
 let sourceCurrent=false;try{sourceCurrent=resolve(batch.sourceRoot)===resolve(process.cwd())&&equal(batch.sourceManifest,await collectDeliverySources(batch.sourceRoot));}catch{/* Missing or changed sources do not prevent observing the frozen profile. */}
 return {batch,sourceCurrent};
}
export function createLocalAcceptanceAuthorization(batch:LocalAcceptanceBatch,options:{kind:'live'|'injected-test-only';expiresAt:number}):LocalAcceptanceAuthorization{
 const p=batch.liveConfig.profile,s=batch.speechPolicy;return LocalAcceptanceAuthorizationSchema.parse({version:1,kind:options.kind,operatorApproved:true,batchId:batch.id,batchDigest:batch.digest,expiresAt:options.expiresAt,maxRequests:batch.maxRequests,maxCostMicros:batch.maxCostMicros,credentialSources:batch.credentials,provider:{providerId:p.providerId,modelId:p.modelId,endpoint:p.endpoint},...(s?{speechProviders:{asr:{providerId:s.asrConfig.providerId,modelId:s.asrConfig.modelId,endpoint:s.asrConfig.endpoint},tts:{providerId:'qianwen',modelId:s.ttsConfig.model,endpoint:s.ttsConfig.endpoint}}}:{})});
}
async function writeApprovalMaterials(output:string,batch:LocalAcceptanceBatch){
 const authorization=createLocalAcceptanceAuthorization(batch,{kind:batch.artifact.kind==='production'?'live':'injected-test-only',expiresAt:0});
 await writeFile(join(output,'authorization.template.json'),JSON.stringify({...authorization,operatorApproved:false},null,2)+'\n',{flag:'wx',mode:0o600});
 const lines=[`# 本地在线验收冻结批次`,`${batch.id} / ${batch.digest}`,`模式 ${batch.mode}；全批最多 ${batch.maxRequests} HTTP；${batch.maxCostMicros} CNY micros 声明预算（非厂商账单）。`,
  'prepare不读取凭证、不联网。模板operatorApproved=false且expiresAt=0，不能直接执行。',
  'SHA256只校验一致性，不是防恶意本地actor的签名。一批仅claim一次，失败不重置。',
  'humanReferenceCount=0；qualityClaimEligible=false；输入来源：'+batch.samples.map(s=>s.roleId+': '+s.origin).join('；'),
  '## 供应商、模型和凭证声明',JSON.stringify({provider:authorization.provider,speechProviders:authorization.speechProviders,credentialSources:authorization.credentialSources},null,2),
  '## 每岗独立额度',JSON.stringify({sessionBudget:batch.sessionBudget,speechPolicy:batch.speechPolicy},null,2),
  '## 固定模型策略',JSON.stringify(batch.liveConfig,null,2),
  '## 冻结输入',JSON.stringify(batch.samples,null,2),
  '## 生产产物及源摘要',JSON.stringify({artifact:batch.artifact,sourceRoot:batch.sourceRoot,sourceDigest:batch.sourceDigest},null,2)];
 // The earlier short review is replaced only during this newly created prepare; never at execute/recover.
 await writeFile(join(output,'review.md'),lines.join('\n\n')+'\n',{mode:0o600});
}
export async function claimLocalAcceptance(path:string,batch:LocalAcceptanceBatch,raw:unknown,options:ReadOptions&{mode:'live'|'injected-test-only';now?:()=>number}){
 const current=await readLocalAcceptance(path,options),auth=LocalAcceptanceAuthorizationSchema.parse(raw),now=(options.now??Date.now)();if(!equal(current,batch)||auth.expiresAt<=now||auth.kind!==options.mode||options.mode==='live'&&batch.artifact.kind!=='production'||options.mode==='injected-test-only'&&batch.artifact.kind!=='injected-test-only'||!equal(auth,createLocalAcceptanceAuthorization(batch,{kind:options.mode,expiresAt:auth.expiresAt})))invalid();
 const execution={version:1,batchId:batch.id,batchDigest:batch.digest,kind:auth.kind,claimedAt:now,authorization:auth,authorizationDigest:contentHash(auth),status:'claimed-once-no-automatic-retry'};await assertLocalAcceptancePath(join(path,'execution.json'));await writeFile(join(path,'execution.json'),JSON.stringify(execution,null,2)+'\n',{flag:'wx',mode:0o600});return execution;
}




