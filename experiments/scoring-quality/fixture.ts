import type {VerificationGoal} from '../../packages/contracts/src/verification-binding.ts';
/** Inference receives only question/rubric/answer. This deterministic fixture is not a semantic judge. */
export function scoringQualityFixture(options:{normalZero?:boolean;partialScore?:1|2|3}={}){return async(input:RequestInfo|URL,init?:RequestInit)=>{
 const body=await new Request(input,init).json()as any;const content=body.messages.findLast((m:any)=>m.role==='user').content;
 const payload=JSON.parse(typeof content==='string'?content:content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join(''));
 const text=payload.interview.answer.text as string,missing=['具体边界、执行操作和结果还没有说明','具体机制和代码判断暂时没有展开','状态还没有给出说明'].some(s=>text.includes(s));
 const java=payload.rubric.roleId==='java-backend',hasGoal=payload.rubric.criteria.some((c:any)=>c.verificationGoal);
 const local=hasGoal?text.slice(text.lastIndexOf(java?'假设初值':'假设在相同')).split('；')[0]!:'';
 const ref=(excerpt:string)=>({evidenceId:'unit',excerpt});
 const wrong=text.includes('volatile 会让 count++')||text.includes('每个搜索响应一回来就直接覆盖');
 const challenge=payload.rubric.version==='challenge-draft-1',value=challenge?(java?'最多100':'下降80%'):(java?'最多1':'下降20%');
 const score=wrong||options.normalZero&&!hasGoal?0:3;
 const output={evidence:missing?[]:[{id:'all',excerpt:text},...(hasGoal?[{id:'unit',excerpt:local}]:[])],criterionScores:payload.rubric.criteria.map((c:{id:string;verificationGoal?:VerificationGoal},index:number)=>({criterionId:c.id,score:missing?null:challenge?(hasGoal?0:payload.rubric.criteria.length===2?(index===0?3:0):(options.partialScore??2)):score,evidenceIds:missing?[]:[c.verificationGoal?'unit':'all'],
  ...(c.verificationGoal&&!missing?{verificationBinding:{goalId:c.verificationGoal.id,goalVersion:c.verificationGoal.version,mode:'proposed',action:ref(java?'并发申请':'对照测量'),target:ref(java?'容量计数器':'列表组件'),expectation:ref((java?'预期成功数':'预期actualDuration')+value),
   observation:{metric:ref(java?'成功数':'actualDuration'),value:{...ref(value),...(challenge&&!java?{context:{before:'actualDuration',after:''}}:{})},condition:ref(java?'初值99':'相同交互')}}}:{})})),feedback:{strengths:[],improvements:['合成结构演练，不是模型语义质量证据']}};
 // Explicit protocol fixture: use only IDs actually supplied in this request's catalog.
 if(payload.verificationCandidates)for(const item of output.criterionScores){const raw=item as unknown as Record<string,unknown>,catalog=payload.verificationCandidates.find((c:any)=>c.criterionId===item.criterionId);if(!catalog||item.score===null)continue;
  const pick=(part:string,excerpt:string)=>{const c=catalog[part]?.filter((c:any)=>part==='expectation'?c.excerpt.includes(excerpt):c.excerpt===excerpt).at(-1);if(!c)throw Error('synthetic candidate absent');return c.id;};
  delete raw.verificationBinding;raw.evidenceIds=[];
  raw.verificationSelection={mode:'proposed',action:pick('action',java?'并发申请':'对照测量'),target:pick('target',java?'容量计数器':'列表组件'),expectation:pick('expectation',(java?'预期成功数':'预期actualDuration')+value),
   observation:{metric:pick('metric',java?'成功数':'actualDuration'),value:pick('value',value),condition:pick('condition',java?'初值99':'相同交互')}};
 }
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
};}
