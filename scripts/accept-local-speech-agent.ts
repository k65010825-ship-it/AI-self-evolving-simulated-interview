import {mkdir,mkdtemp,copyFile,writeFile,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {collectDeliverySources} from '../evals/delivery/sources.ts';import {canonical,contentHash} from '../evals/answers/validation.ts';
import {check,runSpeechStdioScenario} from '../tests/helpers/local-speech-config.ts';
/** Separate test-only artifact, never an input to the production sidecar build. */
export async function buildInjectedLocalSpeechAgent(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('LOCAL_BUILD_PLATFORM_UNSUPPORTED');
 const root=resolve('.cache/local-speech-injected-build');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'injected-test-only-')),assetsRoot=join(output,'assets');await mkdir(assetsRoot);
 const built=await Bun.build({entrypoints:[resolve('experiments/local-runtime/speech-fixture.ts')],outdir:output,target:'bun',format:'esm',naming:'injected-speech-runtime.js',minify:false});check(built.success,'LOCAL_SPEECH_BUILD_FAILED');
 const executable=join(output,'bun.exe'),entry=join(output,'injected-speech-runtime.js');await copyFile(resolve('node_modules/@oven/bun-windows-x64/bin/bun.exe'),executable);
 const files=[];for(const name of ['injected-speech-runtime.js','bun.exe'])files.push({name,sha256:createHash('sha256').update(await readFile(join(output,name))).digest('hex')});
 const manifest={version:1,purpose:'injected-test-only',distribution:'non-production',productionEligible:false,protocolVersion:1,profileSchemaVersion:3,bunVersion:Bun.version,syntheticCredentialFixture:true,realNetworkDisabled:true,speechTransports:['llm','asr','tts'],knowledge:'embedded-versioned-development-seed',files};
 await writeFile(join(assetsRoot,'manifest.json'),JSON.stringify({...manifest,digest:contentHash(manifest)},null,2)+'\n',{flag:'wx'});return{output,entry,executable,assetsRoot,manifest};
}
export async function acceptLocalSpeechAgent(){
 const sourceManifest=await collectDeliverySources(process.cwd()),artifact=await buildInjectedLocalSpeechAgent();
 const root=resolve('.cache/local-speech-injected-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-')),dataDir=join(output,'合成用户数据'),cwd=join(output,'独立工作目录');await mkdir(cwd);
 const evidence=await runSpeechStdioScenario({executable:artifact.executable,entry:artifact.entry,assetsRoot:artifact.assetsRoot,dataDir,cwd});
 check(canonical(sourceManifest)===canonical(await collectDeliverySources(process.cwd())),'LOCAL_SOURCE_CHANGED');
 const body={version:1,status:'passed-injected-test-only-local-speech',purpose:'injected-test-only',distribution:'non-production',productionEligible:false,artifact,dataDir,cwd,sourceManifest,sourceDigest:contentHash(sourceManifest),...evidence,
  qualityClaimEligible:false,humanReferenceCount:0,realProviderVerified:false,realUserAnswerVerified:false,microphoneVerified:false,speakerVerified:false,credentialVaultVerified:false,desktopInstallerVerified:false,vendorBillingVerified:false,
  limitations:['Real Pi and stdio use synthetic LLM/ASR/TTS supplier HTTP responses; no external supplier request occurs.','Generated sine/silence input and manual transcript are not recognition quality or actual human performance evidence.','Memory, formal commits and fixed cost holds are local fixture evidence only; provider bills remain unverified.','No desktop, physical audio devices, credential vault or installer integration was verified.']};
 const reportPath=join(output,'report.json');await writeFile(reportPath,JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});return{output,reportPath,artifact:artifact.output,status:body.status,cases:evidence.cases.length,syntheticHttpCalls:evidence.syntheticHttpCalls,liveModelCalls:0,liveAsrCalls:0,liveTtsCalls:0};
}
if(import.meta.main){try{console.log(JSON.stringify(await acceptLocalSpeechAgent()));}catch(e){console.error(e instanceof Error?e.message:'LOCAL_SPEECH_ACCEPTANCE_FAILED');process.exitCode=1;}}
