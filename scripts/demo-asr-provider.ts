import {pathToFileURL} from 'node:url';
import example from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import {createBailianAsrProvider} from '../apps/agent/src/speech/bailian-asr.ts';
import {transcribeSpeech} from '../apps/agent/src/speech/transcribe.ts';
import {confirmSpeechAnswer} from '../apps/agent/src/speech/confirm.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import type {RoleId} from '../packages/contracts/src/tools.ts';
export async function runAsrProviderDemo(roleId:RoleId='java-backend'){
 const f=makeSpeechFixture(roleId);let injectedHttpCalls=0;
 const provider=createBailianAsrProvider({...example,enabled:true,authorization:{allowLive:true,expiresAt:Date.now()+60000}},
  {context:f.input.context,readCredential:()=> 'synthetic-not-a-real-key',fetch:async()=>{injectedHttpCalls++;
   return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:f.text},finish_reason:'stop'}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
 const transcript=await transcribeSpeech(f.input,{provider});
 const answer=confirmSpeechAnswer(transcript,{transcriptionId:transcript.transcriptionId,audioSha256:transcript.audio.sha256,
  userId:transcript.userId,roleId,answerId:'demo-answer',text:transcript.originalText,confirmedAt:Date.now()});
 return{roleId,scope:'injected-http-generated-sine-hand-authored-transcript',liveAsrCalls:0,liveModelCalls:0,injectedHttpCalls,
  // live-asr is the selected transport mode; injected HTTP proves no recognition quality.
  selectedProviderMode:transcript.mode,kind:answer.kind,confirmedText:answer.answer.text,accounting:provider.accounting(),
  formalCommitted:false,vendorBillingVerified:false,desktopMicrophoneVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend'] as const)console.log(JSON.stringify(await runAsrProviderDemo(role)));
}
