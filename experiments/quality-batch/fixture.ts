import type {VerificationGoal} from '../../packages/contracts/src/verification-binding.ts';
/** Hand-built wire outputs validate plumbing, not scoring semantics. Never used for live execution. */
export async function qualityFixtureFetch(input:RequestInfo|URL,init?:RequestInit){
 const body=await(input instanceof Request?input:new Request(input,init)).json()as {messages:{role:string;content:string|{text?:string}[]}[]};
 const message=body.messages.filter(m=>m.role==='user').at(-1)!.content;
 const request=JSON.parse(typeof message==='string'?message:message.map(c=>c.text??'').join(''))as {interview:{answer:{text:string}};rubric:{criteria:{id:string;verificationGoal?:VerificationGoal}[]}};
 const text=request.interview.answer.text,wrong=text.includes('最多100')||text.includes('解释为渲染更快'),supplement=text.includes('补充本次验证'),missing=!wrong&&!supplement;
 const java=text.includes('容量计数器'),metric=java?'成功数':'actualDuration',value=java?(wrong?'最多100':'最多1'):(wrong?'升高20%':'下降20%'),condition=java?'初值99':'相同交互',action=java?'并发申请':'对照测量',target=java?'容量计数器':'列表组件';
 const ref=(s:string)=>{const start=text.lastIndexOf(s);if(start<0)throw Error('QUALITY_FIXTURE_INVALID');return {evidenceId:'unit',start,end:start+s.length};};
 const expectation='预期'+metric+value;
 const output={evidence:[{id:'unit',start:0,end:text.length,excerpt:text}],criterionScores:request.rubric.criteria.map(c=>({criterionId:c.id,score:missing&&c.verificationGoal?null:wrong?0:3,evidenceIds:missing&&c.verificationGoal?[]:['unit'],
  ...(c.verificationGoal&&!missing?{verificationBinding:{goalId:c.verificationGoal.id,goalVersion:c.verificationGoal.version,mode:'proposed',action:ref(action),target:ref(target),expectation:ref(expectation),observation:{metric:ref(metric),value:ref(value),condition:ref(condition)}}}:{})})),feedback:{strengths:[],improvements:['仅离线结构夹具，不验证分数合理性']}};
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:300,total_tokens:400}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
