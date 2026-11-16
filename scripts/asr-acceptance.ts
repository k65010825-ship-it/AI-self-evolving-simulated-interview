import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import example from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import {AsrServiceConfigSchema,type AsrAccounting} from '../packages/contracts/src/asr-service.ts';
import type {SpeechTranscript} from '../packages/contracts/src/speech.ts';
import {createAsrProvider,preflightAsr} from '../apps/agent/src/speech/bailian-asr.ts';
import {transcribeSpeech} from '../apps/agent/src/speech/transcribe.ts';
import {inspectWav} from '../apps/agent/src/speech/wav.ts';
import {AgentStateError} from '../apps/agent/src/planning/interview-state.ts';
interface AcceptanceDependencies {readCredential:(name:string)=>string|undefined;fetch?:(url:string,init:RequestInit)=>Promise<Response>}
interface AcceptanceReport {version:1;status:'passed-transport-candidate'|'failed';networkMode:'injected-http'|'provider-network';
 modelId:string;endpoint:string;httpAttempts:number;liveAsrCalls:number;accounting:AsrAccounting;transcript?:SpeechTranscript;errorCode?:string;
 formalCommitted:false;vendorBillingVerified:false;humanSpeechAccuracyVerified:false}
/** Explicit tiny acceptance envelope; a failed/unknown attempt is never retried. */
export async function runAsrAcceptance(raw:unknown,wavBytes:Uint8Array,deps:AcceptanceDependencies):Promise<AcceptanceReport>{
 const p=AsrServiceConfigSchema.safeParse(raw);if(!p.success)throw new AgentStateError('VALIDATION_ERROR');const c=p.data,at=Date.now();
 if(c.providerId!=='qianwen'||!c.enabled||!c.authorization.allowLive||c.authorization.expiresAt<=at||c.authorization.expiresAt>at+600000||
  c.budget.maxCalls!==1||c.budget.maxTotalAudioMs>10000||c.budget.maxCostMicros!==100000||c.budget.reserveCostMicrosPerCall!==100000||c.maxOutputTokens>512)throw new AgentStateError('FORBIDDEN');
 if(inspectWav(wavBytes).durationMs>c.budget.maxTotalAudioMs)throw new AgentStateError('TOOL_BUDGET_EXCEEDED');
 const id=randomUUID(),context={userId:'acceptance-local',roleId:'java-backend' as const,runId:id,attemptId:'attempt-1',deadlineAt:Math.min(c.authorization.expiresAt,at+c.timeoutMs)};
 let httpAttempts=0;const fetcher=deps.fetch??globalThis.fetch;
 const provider=createAsrProvider(c,{context,readCredential:deps.readCredential,fetch:async(url,init)=>{httpAttempts++;return fetcher(url,init);}});
 let transcript:SpeechTranscript|undefined,errorCode:string|undefined;
 try{transcript=await transcribeSpeech({context,transcriptionId:`asr-${id}`,audioId:`audio-${id}`,wavBytes},{provider,timeoutMs:c.timeoutMs});}
 catch(error){errorCode=error instanceof AgentStateError?error.code:'DEPENDENCY_UNAVAILABLE';}
 return {version:1,status:transcript?'passed-transport-candidate':'failed',networkMode:deps.fetch?'injected-http':'provider-network',
  modelId:c.modelId,endpoint:c.endpoint,httpAttempts,liveAsrCalls:deps.fetch?0:httpAttempts,accounting:provider.accounting(),
  ...(transcript?{transcript}:{}),...(errorCode?{errorCode}:{}),formalCommitted:false,vendorBillingVerified:false,humanSpeechAccuracyVerified:false};
}
async function limitedFile(path:string,max:number){const info=await stat(path);if(!info.isFile()||info.size>max)throw Error('INPUT_LIMIT');
 const b=await readFile(path);if(b.length>max)throw Error('INPUT_LIMIT');return b;}
export async function asrAcceptanceMain(args:string[]){
 let configPath:string|undefined,audioPath:string|undefined,execute=false;
 for(let i=0;i<args.length;i++){
  const a=args[i];if(a==='--execute'&&!execute){execute=true;continue;}
  if(a==='--config'&&!configPath&&args[i+1]&&!args[i+1]!.startsWith('--')){configPath=args[++i];continue;}
  if(a==='--audio'&&!audioPath&&args[i+1]&&!args[i+1]!.startsWith('--')){audioPath=args[++i];continue;}
  throw Error('ASR_ARGUMENTS_INVALID');
 }
 const raw:unknown=configPath?JSON.parse((await limitedFile(configPath,65536)).toString('utf8')):example;
 if(!execute){console.log(JSON.stringify({...preflightAsr(raw),execution:'plan-only',maxHttpAttempts:1,maxAudioMs:10000,maxOutputTokens:512}));return preflightAsr(raw).configValid?0:2;}
 if(!configPath||!audioPath)throw Error('ASR_ARGUMENTS_INVALID');
 const bytes=await limitedFile(audioPath,4*1024*1024),directory=resolve('.cache/asr-live',`run-${randomUUID()}`);
 await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'intent.json'),JSON.stringify({scope:'explicit-single-request-local-wav',createdAt:Date.now(),maxHttpAttempts:1,audioRetention:'not-copied',vendorBillingVerified:false}));
 const report=await runAsrAcceptance(raw,bytes,{readCredential:name=>process.env[name]});
 const artifact=join(directory,'report.json');await writeFile(artifact,JSON.stringify(report,null,2)+'\n');
 // Avoid dumping transcript or provider errors to the console. Operator owns the local report.
 console.log(JSON.stringify({status:report.status,httpAttempts:report.httpAttempts,liveAsrCalls:report.liveAsrCalls,artifact,vendorBillingVerified:false}));
 return report.status==='passed-transport-candidate'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await asrAcceptanceMain(process.argv.slice(2));}catch{console.error('ASR_ACCEPTANCE_FAILED');process.exitCode=2;}
}
