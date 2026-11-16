/** Test-only real Pi/stdio entry. Every supplier transport is injected; real fetch is disabled. */
import {appendFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {serveLocalStdio} from '../../apps/agent/src/local/stdio.ts';
import {contentText} from '../pi-sdk/planner-fixture.ts';
const keys={llm:'synthetic-speech-llm-private-do-not-store',asr:'synthetic-speech-asr-private-do-not-store',tts:'synthetic-speech-tts-private-do-not-store'};
const event=(value:unknown)=>'data: '+JSON.stringify(value)+'\n\n';
function stream(delta:unknown,reason='stop'){return new Response(event({choices:[{index:0,delta,finish_reason:reason}]})+event({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
globalThis.fetch=Object.assign(async()=>{throw Error('FIXTURE_NETWORK_DISABLED');},{preconnect(){throw Error('FIXTURE_NETWORK_DISABLED');}});
try{
 const values=new Map<string,string>(),args=process.argv.slice(2);for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--data-dir','--assets-root'].includes(key)||!value||!isAbsolute(value)||values.has(key))throw Error();values.set(key,value);}
 const dataDir=values.get('--data-dir'),assetsRoot=values.get('--assets-root');if(!dataDir||!assetsRoot)throw Error();
 const audit=(capability:string,kind:string)=>appendFile(join(dataDir,'speech-fixture-http.jsonl'),JSON.stringify({capability,kind,synthetic:true})+'\n');
 function auth(header:string|null,capability:keyof typeof keys){if(header!=='Bearer '+keys[capability])throw Error('FIXTURE_AUTH_INVALID');}
 await serveLocalStdio({dataDir,assetsRoot,liveFetch:async(input,init)=>{
  const req=new Request(input,init);auth(req.headers.get('authorization'),'llm');const body=await req.json()as any,tool=body.messages.find((m:any)=>m.role==='tool');
  if(tool){await audit('llm','planner-final');const receipt=JSON.parse(contentText(tool.content));return stream({content:JSON.stringify({questionId:receipt.data.items[0].id})});}
  const p=JSON.parse(contentText(body.messages.find((m:any)=>m.role==='user').content));
  if(p.rubric){await audit('llm','evaluation');const text=p.interview.answer.text;return stream({content:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],criterionScores:p.rubric.criteria.map((c:any)=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:['合成反馈'],improvements:['待独立审核']}})});}
  await audit('llm','planner-tool');return stream({tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
 },speechFetch:async(url,init)=>{
  const headers=new Headers(init.headers),body=JSON.parse(init.body as string);
  if(body.model==='qwen3.8-omni-flash'){
   auth(headers.get('authorization'),'asr');if(url!=='https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions'||!body.messages?.[0]?.content?.[0]?.input_audio?.data?.startsWith('data:audio/wav;base64,'))throw Error('FIXTURE_ASR_INVALID');
   await audit('asr','omni-transcription');return stream({content:'合成转写：我会检查状态边界、失败回滚及过期请求处理。'});
  }
  auth(headers.get('authorization'),'tts');if(url!=='https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'||body.model!=='qwen3-tts-flash'||!body.input?.text)throw Error('FIXTURE_TTS_INVALID');
  await audit('tts','pcm-synthesis');return new Response(event({output:{audio:{data:Buffer.alloc(96000).toString('base64')},finish_reason:'stop'}}),{headers:{'content-type':'text/event-stream'}});
 }});
}catch{process.stderr.write('LOCAL_SPEECH_FIXTURE_FAILED\n');process.stdin.destroy();process.exitCode=1;}
