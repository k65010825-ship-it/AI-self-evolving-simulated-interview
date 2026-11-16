/** Test-only process entry: real Pi/stdio with a synthetic HTTP transport, never real fetch. */
import {appendFile} from 'node:fs/promises';import {isAbsolute,join} from 'node:path';
import {serveLocalStdio} from '../../apps/agent/src/local/stdio.ts';
import {contentText} from '../pi-sdk/planner-fixture.ts';
const secret='synthetic-stdio-private-key-do-not-store';
function stream(delta:unknown,reason='stop'){return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:reason}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
globalThis.fetch=Object.assign(async()=>{throw Error('FIXTURE_NETWORK_DISABLED');},{preconnect(){throw Error('FIXTURE_NETWORK_DISABLED');}});
try{
 const args=process.argv.slice(2),values=new Map<string,string>();for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--data-dir','--assets-root'].includes(key)||!value||values.has(key)||!isAbsolute(value))throw Error();values.set(key,value);}
 const dataDir=values.get('--data-dir'),assetsRoot=values.get('--assets-root');if(!dataDir||!assetsRoot)throw Error();
 await serveLocalStdio({dataDir,assetsRoot,liveFetch:async(input,init)=>{
  const req=new Request(input,init);if(req.headers.get('authorization')!=='Bearer '+secret)throw Error('FIXTURE_AUTH_INVALID');
  const body=await req.json()as any,tool=body.messages.find((m:any)=>m.role==='tool');
  if(tool){await appendFile(join(dataDir,'fixture-http.jsonl'),JSON.stringify({kind:'planner-final',synthetic:true})+'\n');const receipt=JSON.parse(contentText(tool.content));return stream({content:JSON.stringify({questionId:receipt.data.items[0].id})});}
  const p=JSON.parse(contentText(body.messages.find((m:any)=>m.role==='user').content));
  if(p.rubric){await appendFile(join(dataDir,'fixture-http.jsonl'),JSON.stringify({kind:'evaluation',synthetic:true})+'\n');const text=p.interview.answer.text;return stream({content:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],criterionScores:p.rubric.criteria.map((c:any)=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:['合成反馈'],improvements:['待独立审核']}})});}
  await appendFile(join(dataDir,'fixture-http.jsonl'),JSON.stringify({kind:'planner-tool',synthetic:true})+'\n');return stream({tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
 }});
}catch{process.stderr.write('LOCAL_FIXTURE_FAILED\n');process.stdin.destroy();process.exitCode=1;}
