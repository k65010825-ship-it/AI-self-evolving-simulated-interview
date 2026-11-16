import{pathToFileURL}from'node:url';
import{mkdir,writeFile}from'node:fs/promises';
import{join}from'node:path';
import{runBailianAcceptance}from'../evals/live-bailian/runner.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import{contentText}from'../experiments/pi-sdk/planner-fixture.ts';
function stream(delta:unknown,reason='stop'){
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:reason}]})+'\n\n'+
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
/** Real SDK, injected HTTP responses and synthetic usage only; never a vendor network call. */
export async function runModelRecoveryDemo(){
 const c={...config,planning:'pi-knowledge',recovery:{httpMaxAttempts:3,maxModelRepairs:1,baseDelayMs:1,maxDelayMs:5},
  authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000},
  profile:{...config.profile,limits:{...config.profile.limits,maxCalls:5,maxTotalTokens:67500,maxCostMicros:250000}}};
 const grades=new Map<string,number>();
 const report=await runBailianAcceptance(c,{readCredential:()=> 'synthetic-recovery-credential',fetch:async(input,init)=>{
  const body=JSON.parse(await new Request(input,init).text()),messages=body.messages as{role:string;content:Parameters<typeof contentText>[0]}[];
  const tool=messages.find(m=>m.role==='tool');
  if(tool){const receipt=JSON.parse(contentText(tool.content));return stream({role:'assistant',content:JSON.stringify({questionId:receipt.data.items[0].id})});}
  const p=JSON.parse(contentText(messages.find(m=>m.role==='user')!.content));
  if(p.rubric){const role=p.rubric.roleId as string,n=(grades.get(role)??0)+1;grades.set(role,n);
   if(n===1)return new Response('synthetic rate limit',{status:429,headers:{'retry-after':'0'}});
   if(n===2)return stream({role:'assistant',content:'invalid-json-synthetic'});
   const text=p.interview.answer.text as string;return stream({role:'assistant',content:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],
    criterionScores:p.rubric.criteria.map((criterion:{id:string;maxScore:number})=>({criterionId:criterion.id,score:criterion.maxScore/2,evidenceIds:['e']})),
    feedback:{strengths:['合成边界描述'],improvements:['需人工复核']}})});
  }
  return stream({role:'assistant',tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
 }},{execute:true});
 if(report.mode==='plan-only')throw Error('DEMO_EXECUTION_EXPECTED');
 return{scope:'injected-http-pi-recovery' as const,report,rejectedPendingReconciliation:report.accounting.flatMap(s=>s.entries).filter(e=>e.status==='rejected').length,
  liveModelCalls:0 as const,formalCommitted:false as const,vendorResilienceVerified:false as const};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await runModelRecoveryDemo(),dir=join(process.cwd(),'.cache','model-recovery-demo');await mkdir(dir,{recursive:true});
 const file=join(dir,'report.json');await writeFile(file,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({scope:result.scope,status:result.report.status,httpAttempts:result.report.httpAttempts,settledSyntheticTokens:result.report.settledTokens,
  rejectedPendingReconciliation:result.rejectedPendingReconciliation,heldCostMicros:result.report.heldCostMicros,report:file,liveModelCalls:0,formalCommitted:false}));
}
