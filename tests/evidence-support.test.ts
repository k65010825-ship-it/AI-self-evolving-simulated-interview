import{test,expect}from'bun:test';
import{createScoringExecutor}from'../apps/agent/src/tools/scoring-executor.ts';
import{createInterviewState}from'../apps/agent/src/planning/interview-state.ts';
import{evaluateTurnWithClarification}from'../apps/agent/src/orchestration/clarify-turn.ts';
const at=1000000;
function scorer(text:string,dimension:'verification'|'ownership'|'correctness'='correctness',allow=true){return createScoringExecutor({userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:at+60000,answerId:'answer',answerText:text,evidence:[{id:'e',start:0,end:text.length,excerpt:text}]},
 [{id:'rubric',version:'1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'c',maxScore:4,weight:1,required:true,dimension}]}],{allowRequiredAbstention:allow});}
const command=(score:number|null)=>({rubricId:'rubric',rubricVersion:'1',criterionScores:[{criterionId:'c',score,evidenceIds:score===null?[]:['e']}]});
test('explicit no-answer citations cannot produce zero or positive grades',async()=>{
 for(const text of ['不知道。','我不清楚',' I do not know. ','暂时不会'])for(const n of [0,4]){
  const receipt=await scorer(text)('call',command(n),undefined,()=>at);expect(receipt.status).toBe('insufficient_evidence');expect(receipt.data?.normalizedScore).toBeNull();expect(receipt.data?.dimensions[0]?.evidenceIds).toEqual([]);
 }
 expect((await scorer('不知道','correctness',false)('call',command(0),undefined,()=>at)).status).toBe('error');
});
test('risk and instrumentation recommendations alone do not support verification or ownership',async()=>{
 for(const text of ['容易触发多次请求，应该增加防抖。','建议上报日志，方便排查页面白屏。']){
  expect((await scorer(text,'verification')('call',command(3),undefined,()=>at)).data?.normalizedScore).toBeNull();
  expect((await scorer(text,'ownership')('call',command(3),undefined,()=>at)).data?.normalizedScore).toBeNull();
 }
});
test('hypothetical test procedures and declared changes remain admissible',async()=>{
 for(const [text,dimension]of [['假设返回500错误，我会检查页面是否显示重试入口。','verification'],['我负责修改请求状态机，并补充了异常处理。','ownership']]as const){
  const result=await scorer(text,dimension)('call',command(3),undefined,()=>at);expect(result.status).toBe('ok');expect(result.data?.normalizedScore).toBe(.75);
 }
 // A wrong substantive statement remains evidence for a real zero.
 expect((await scorer('加上volatile以后复合更新就始终原子。')('call',command(0),undefined,()=>at)).data?.normalizedScore).toBe(0);
 expect((await scorer('用控制台没报错就能证明并发始终正确。','verification')('call',command(0),undefined,()=>at)).data?.normalizedScore).toBe(0);
});
function input(text:string){return{state:createInterviewState({sessionId:'s',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'x',relevance:1}]},at),expectedVersion:0,observationId:'o',goal:'offline regression',context:{userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:at+60000},
 question:{id:'q',roleId:'java-backend',skillId:'x',questionType:'technical',difficulty:2,text:'解释一个边界'},answer:{id:'answer',text},quality:1,knowledge:[],rubric:{id:'rubric',version:'1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'c',maxScore:4,weight:1,required:true}]}};}
test('whole-turn no-answer abstains before provider dispatch and leaves state untouched',async()=>{
 const raw=input('不知道'),before=JSON.stringify(raw);let calls=0;const diagnostics:unknown[]=[];
 const r=await evaluateTurnWithClarification(raw,{now:()=>at,onDiagnostic:e=>diagnostics.push(e),evaluate:async()=>{calls++;throw Error('must not call');}},{policy:{maxClarifications:0,minRemainingSeconds:45}});
 expect(r.status).toBe('abstained');expect(calls).toBe(0);expect(JSON.stringify(raw)).toBe(before);expect(JSON.stringify(diagnostics)).toContain('no-substantive-answer');
});
test('a no-answer phrase inside a substantive answer is not discarded',async()=>{
 const text='暂时不知道异常类型，但更新和去重应在同一个事务内提交。';let calls=0;
 const r=await evaluateTurnWithClarification(input(text),{now:()=>at,evaluate:async()=>{calls++;return{evidence:[{id:'e',start:0,end:text.length,excerpt:text}],criterionScores:[{criterionId:'c',score:2,evidenceIds:['e']}],feedback:{strengths:[],improvements:['补充异常分类']}};}},{});
 expect(r.status).toBe('scored');expect(calls).toBe(1);
});
test('a bare negative or punctuation symbol can be a substantive answer, not an admission of ignorance',async()=>{
 for(const text of ['不会','-']){let calls=0;const r=await evaluateTurnWithClarification(input(text),{now:()=>at,evaluate:async()=>{calls++;return{evidence:[{id:'e',start:0,end:text.length,excerpt:text}],criterionScores:[{criterionId:'c',score:0,evidenceIds:['e']}],feedback:{strengths:[],improvements:['合成反例：这里有明确错误答案依据']}};}},{});
 expect(r.status).toBe('scored');expect(calls).toBe(1);}
});
test('a rejected verification citation becomes one missing dimension, not a zero or a mastery observation',async()=>{
 const raw=input('使用请求编号隔离旧响应。容易多次发送，建议记录日志。');raw.rubric.criteria=[
  {id:'c',maxScore:4,weight:.5,required:true},
  {id:'verify',maxScore:4,weight:.5,required:true,dimension:'verification'} as typeof raw.rubric.criteria[number],
 ];
 const split=raw.answer.text.indexOf('容易'),r=await evaluateTurnWithClarification(raw,{now:()=>at,evaluate:async()=>({
  evidence:[{id:'good',start:0,end:split,excerpt:raw.answer.text.slice(0,split)},{id:'risk',start:split,end:raw.answer.text.length,excerpt:raw.answer.text.slice(split)}],
  criterionScores:[{criterionId:'c',score:2,evidenceIds:['good']},{criterionId:'verify',score:3,evidenceIds:['risk']}],feedback:{strengths:[],improvements:['补验证']}
 })},{policy:{maxClarifications:0,minRemainingSeconds:45}});
 expect(r.status).toBe('abstained');if(r.status==='scored')throw Error('unsafe score');expect(r.missingCriterionIds).toEqual(['verify']);expect(r.normalizedScore).toBeNull();expect(raw.state.observations).toEqual([]);
});
test('no-answer short-circuit does not bypass pre-cancel, identity or stale-version checks',async()=>{
 const raw=input('不知道');let calls=0;const deps={now:()=>at,evaluate:async()=>{calls++;throw Error('must not run');}};
 const ctl=new AbortController();ctl.abort();await expect(evaluateTurnWithClarification(raw,{...deps,signal:ctl.signal},{})).rejects.toThrow('RUN_CANCELLED');
 const wrong=structuredClone(raw);wrong.context.roleId='web-frontend';await expect(evaluateTurnWithClarification(wrong,deps,{})).rejects.toThrow('ROLE_FORBIDDEN');
 await expect(evaluateTurnWithClarification({...raw,expectedVersion:1},deps,{})).rejects.toThrow('VERSION_CONFLICT');expect(calls).toBe(0);
});
