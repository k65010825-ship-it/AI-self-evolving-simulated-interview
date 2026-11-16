/** Injected fault entry. Never included in the production sidecar. */
import {appendFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {serveLocalStdio} from '../../apps/agent/src/local/stdio.ts';
import {contentText} from '../pi-sdk/planner-fixture.ts';
declare const LOCAL_ACCEPTANCE_SCENARIO: string;
const allowed = ['missing-credential','asr-429','asr-timeout','cancel-late','crash-after-dispatch','recover'];
const event = (v: unknown) => 'data: '+JSON.stringify(v)+'\n\n';
function stream(delta: unknown, reason = 'stop') {
 return new Response(event({choices:[{index:0,delta,finish_reason:reason}]})+event({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
globalThis.fetch = Object.assign(async()=>{throw Error('DRILL_REAL_NETWORK_DISABLED');},{preconnect(){throw Error('DRILL_REAL_NETWORK_DISABLED');}});
try {
 const values = new Map<string,string>(), args = process.argv.slice(2);
 for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--data-dir','--assets-root','--scenario'].includes(key)||!value||values.has(key))throw Error();values.set(key,value);}
 const dataDir=values.get('--data-dir'),assetsRoot=values.get('--assets-root');
 const scenario=values.get('--scenario')??LOCAL_ACCEPTANCE_SCENARIO;
 if(!dataDir||!assetsRoot||!isAbsolute(dataDir)||!isAbsolute(assetsRoot)||!allowed.includes(scenario))throw Error();
 const audit=(capability:string,kind:string)=>appendFile(join(dataDir,'drill-http.jsonl'),JSON.stringify({capability,kind,synthetic:true})+'\n');
 await serveLocalStdio({dataDir,assetsRoot,leaseMs:2000,
  liveFetch:async(input,init)=>{
   if(scenario==='recover')throw Error('DRILL_RECOVERY_HTTP_FORBIDDEN');
   const req=new Request(input,init);if(req.headers.get('authorization')!=='Bearer synthetic-drill-llm-private')throw Error('DRILL_AUTH_INVALID');
   const body=await req.json() as any,tool=body.messages.find((m:any)=>m.role==='tool');
   await audit('llm',tool?'planner-final':'planner-tool');
   if(tool)return stream({content:JSON.stringify({questionId:JSON.parse(contentText(tool.content)).data.items[0].id})});
   const p=JSON.parse(contentText(body.messages.find((m:any)=>m.role==='user').content));
   return stream({tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
  },speechFetch:async(_url,init)=>{
   if(scenario==='recover')throw Error('DRILL_RECOVERY_HTTP_FORBIDDEN');
   if(new Headers(init.headers).get('authorization')!=='Bearer synthetic-drill-asr-private')throw Error('DRILL_AUTH_INVALID');
   await audit('asr',scenario==='crash-after-dispatch'?'wrapper-entered-before-exit':scenario);
   // The host persisted dispatch before entering this wrapper. No supplier received a request.
   if(scenario==='crash-after-dispatch')process.exit(23);
   if(scenario==='asr-429')return new Response('{}',{status:429});
   if(scenario==='asr-timeout')return new Promise<Response>((_resolve,reject)=>{
    const abort=()=>reject(new DOMException('Synthetic timeout','AbortError'));
    if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
   });
   if(scenario==='cancel-late'){
    // Deliberately ignore abort: physical occupancy must last until this resolves.
    await new Promise(r=>setTimeout(r,500));await audit('asr-settlement','late-valid-response');
    return stream({content:'合成迟到转写：我会检查事务状态并验证失败回滚。'});
   }
   throw Error('DRILL_UNEXPECTED_ASR');
  },
 });
}catch{process.stderr.write('LOCAL_ACCEPTANCE_DRILL_RUNTIME_FAILED\n');process.stdin.destroy();process.exitCode=1;}
