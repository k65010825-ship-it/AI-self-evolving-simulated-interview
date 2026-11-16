import {Database} from 'bun:sqlite';import {mkdirSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import type {PilotConfig} from './config.ts';
import {createAgentApp} from '../agent/src/app.ts';import {createOfflineRunManager} from '../agent/src/runtime/offline-runtime.ts';
import {createPilotAgentRuntime} from '../agent/src/runtime/pilot-runtime.ts';import {createSpeechTaskManager} from '../agent/src/speech/task-manager.ts';
import {createAsrProvider} from '../agent/src/speech/bailian-asr.ts';import asrExample from '../agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import {openSessionAccounting} from '../agent/src/accounting/session-ledger.ts';import{createSessionCheckpointAdapter}from'../agent/src/accounting/checkpoint-adapter.ts';
import {createExpressionAssessor} from '../agent/src/speech/expression-assessment.ts';import {synthesizeTts} from '../agent/src/speech/tts.ts';
import {QuestionVoiceRequestSchema} from '../../packages/contracts/src/tts.ts';import {AgentStateError} from '../agent/src/planning/interview-state.ts';
import {prepareQuestionAudioStore,recoverExpiredQuestionAudio} from './voice-recovery.ts';
export async function createPilotAgent(config:PilotConfig,host:{apiUrl:()=>string;readCredential:(name:string)=>string|undefined}){
 mkdirSync(config.stateDir,{recursive:true});const ledger=openSessionAccounting(join(config.stateDir,'accounting.sqlite'));ledger.recoverExpired();
 const runtime=config.mode==='live'?createPilotAgentRuntime({path:join(config.stateDir,'agent.sqlite'),bindingsPath:join(config.stateDir,'bindings.sqlite'),ledger,liveConfig:config.model,readCredential:host.readCredential}):
  await createOfflineRunManager({planning:'pi-knowledge',questionDelivery:'natural-bridge'});
 const authorize=async(path:string,body:unknown)=>{
  const url=new URL(host.apiUrl());if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))return false;
  const response=await fetch(new URL(path,url),{method:'POST',redirect:'error',headers:{authorization:`Bearer ${config.internalToken}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(900)});
  if(!response.ok)return false;const parsed=await response.json() as {allowed?:unknown};return parsed.allowed===true;
 };
 const reserve=(sessionId:string,userId:string,roleId:string,operationId:string,kind:'llm'|'tts',cost=100000)=>{
  ledger.reserve({sessionId,userId,roleId,operationId,attemptId:operationId,kind,reservedCostMicros:cost,pricing:{source:'qianwen-host-declared-unverified',version:'2026-11-06',unit:kind==='tts'?'character':'request'}});
  ledger.dispatch(sessionId,operationId);
 };
 const uncertain=(sessionId:string,id:string)=>{const e=ledger.snapshot(sessionId).entries.find(e=>e.attemptId===id);if(e?.status==='dispatched')ledger.markUnknown(sessionId,id);};
 const speech=createSpeechTaskManager({path:join(config.stateDir,'speech.sqlite'),maxTasks:1000,maxRunning:4,
  authorize:r=>authorize('/internal/v1/speech/authorization',r),
  providerFor:({context,request,onCheckpoint})=>{
   if(config.mode==='offline-fixture')return{id:'offline-pilot-manual-asr',version:'1',mode:'offline-fixture',transcribe:async()=>({text:'离线示例：先说明边界，再给出失败恢复和验证方法。',language:'zh-CN',segments:[]})};
   const adapter=createSessionCheckpointAdapter({ledger,binding:{sessionId:request.binding.sessionId,userId:context.userId,roleId:context.roleId,runId:context.runId},pricing:{source:'qianwen-omni-host-hold-not-invoice',version:'2026-11-06',unit:'request'}});
   return createAsrProvider({...asrExample,enabled:true,authorization:{allowLive:true,expiresAt:config.model.authorization.expiresAt},
    budget:{...asrExample.budget,maxTotalAudioMs:120000}}, {context,readCredential:host.readCredential,onCheckpoint:s=>{adapter.asr(s);onCheckpoint(s);}});
  },
  ...(config.mode==='live'&&config.expressionEnabled?{assessExpression:async(input:any,signal:AbortSignal)=>{
   const {context,request,transcript,wavBytes}=input;const scope=request.binding.sessionId;let operationId='';
   const analyzer=createExpressionAssessor({version:1,enabled:true,providerId:'qianwen',modelId:'qwen3.8-omni-flash',endpoint:asrExample.endpoint,timeoutMs:7000,maxOutputTokens:1000,
    authorization:{allowLive:true,expiresAt:config.model.authorization.expiresAt},budget:{maxCalls:1,maxTotalAudioMs:120000,maxCostMicros:100000,reserveCostMicrosPerCall:100000}},
    {context,voiceKey:host.readCredential('INTERVIEW_BAILIAN_ASR_API_KEY')??'',beforeDispatch:e=>{operationId=e.callId;reserve(scope,context.userId,context.roleId,operationId,'llm');},
     onResponse:()=>{if(operationId)ledger.completeResponse(scope,operationId);},onUnknown:()=>{if(operationId)uncertain(scope,operationId);}});
   return analyzer.assess({wavBytes,originalText:transcript.originalText},signal);
  }}:{}),
 });
 const db=new Database(join(config.stateDir,'voice.sqlite'),{create:true,strict:true});db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 prepareQuestionAudioStore(db);recoverExpiredQuestionAudio(db,ledger);
 let ttsActive=0;
 async function synthesizeQuestion(raw:unknown){const input=QuestionVoiceRequestSchema.parse(raw);if(!await authorize('/internal/v1/voice/authorization',input))throw new AgentStateError('FORBIDDEN');
  recoverExpiredQuestionAudio(db,ledger);
  const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  let executionDeadline=input.deadlineAt;
  const cached=db.transaction(()=>{const row=db.query('SELECT * FROM question_audio WHERE operation_id=?').get(input.operationId) as {digest:string;status:string;audio:Uint8Array|null}|null;
   if(row){if(row.digest!==digest)throw new AgentStateError('VERSION_CONFLICT');if(row.status==='completed')return row.audio!;throw new AgentStateError(row.status==='running'?'RATE_LIMITED':'DEPENDENCY_UNAVAILABLE');}
   if(ttsActive>=2)throw new AgentStateError('RATE_LIMITED');
   executionDeadline=Math.min(input.deadlineAt,Date.now()+30000,config.mode==='live'?config.model.authorization.expiresAt:Infinity);
   db.query('INSERT INTO question_audio(operation_id,digest,status,audio,deadline_at,session_id) VALUES(?,?,?,NULL,?,?)').run(input.operationId,digest,'running',executionDeadline,input.sessionId);return null;
  }).immediate();if(cached)return new Uint8Array(cached);ttsActive++;
  try{let audio:Uint8Array;
   if(config.mode==='offline-fixture'){const pcm=Buffer.alloc(24000);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.1)*2000),i*2);
    const w=Buffer.alloc(44+pcm.length);w.write('RIFF');w.writeUInt32LE(w.length-8,4);w.write('WAVEfmt ',8);w.writeUInt32LE(16,16);w.writeUInt16LE(1,20);w.writeUInt16LE(1,22);w.writeUInt32LE(24000,24);w.writeUInt32LE(48000,28);w.writeUInt16LE(2,32);w.writeUInt16LE(16,34);w.write('data',36);w.writeUInt32LE(pcm.length,40);pcm.copy(w,44);audio=new Uint8Array(w);
   }else{if(!config.model.authorization.enabled||!config.model.authorization.operatorApproved||Date.now()>=config.model.authorization.expiresAt)throw new AgentStateError('FORBIDDEN');
    const result=await synthesizeTts({text:input.text,operationId:input.operationId,deadlineAt:executionDeadline},
     {enabled:true,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'},
     {readCredential:host.readCredential,beforeDispatch:()=>reserve(input.sessionId,input.userId,input.roleId,input.operationId,'tts'),
      onResponse:()=>{ledger.completeResponse(input.sessionId,input.operationId);},onUnknown:()=>uncertain(input.sessionId,input.operationId)});audio=result.wavBytes;
   }
   db.query("UPDATE question_audio SET status='completed',audio=? WHERE operation_id=? AND status='running'").run(audio,input.operationId);return audio;
  }catch(e){db.query("UPDATE question_audio SET status='failed' WHERE operation_id=? AND status='running'").run(input.operationId);throw e;}finally{ttsActive--;}
 }
 const app=createAgentApp({runtime,speech,synthesizeQuestion,internalToken:config.internalToken,runtimeMode:config.mode==='live'?'live-runtime':'offline-runtime'});
 return{app,runtime,speech,ledger,async close(){if(ttsActive)throw Error('TTS busy');
  const drain=await runtime.shutdown({graceMs:500,cancelWaitMs:1000});if(drain.status==='incomplete')throw Error('Agent workers not drained');
  speech.close();if('close' in runtime&&typeof runtime.close==='function')runtime.close();else runtime.dispose();db.close();ledger.close();}};
}
