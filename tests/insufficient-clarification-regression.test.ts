import {test,expect} from 'bun:test';
import {loadScoringQualityCases,scoringQualityRequest} from '../evals/scoring-quality/dataset.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {NEUTRAL_CLARIFICATION_PROMPT} from '../packages/contracts/src/clarification.ts';
for(const role of ['java-backend','web-frontend']as const)test(role+': missing stays unknown, continuation can score grounded zero or a correct answer, repeated missing abstains',async()=>{
 const sample=loadScoringQualityCases().find(c=>c.roleId===role&&c.category==='insufficient')!,now=Date.now(),req=scoringQualityRequest(sample,now,now+120000,'first-'+role);
 if(req.job.type!=='turn')throw Error();const input=req.job.input;
 const missing={evidence:[],criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score:null,evidenceIds:[]})),feedback:{strengths:[],improvements:['补充技术判断及理由']}};
 let output:unknown=missing;const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(output)}));
 const evaluate=createPiEvaluator({cwd:process.cwd(),roleId:role,modelRuntime:sdk.runtime,model:sdk.model,evidenceGrounding:'quoted-spans'});
 const first=await evaluateTurnWithClarification(input,{evaluate});expect(first.status).toBe('needs_clarification');if(first.status==='scored')throw Error();
 expect(first.normalizedScore).toBeNull();expect(first.clarification).toBe(NEUTRAL_CLARIFICATION_PROMPT);expect(input.state.observations).toHaveLength(0);
 for(const score of [0,3]){
  const text=score===0?(role==='java-backend'?'volatile能让count++整个操作原子化，并发时绝不会丢失更新。':'每个搜索响应都直接覆盖结果，旧结果覆盖新结果也不需要处理。'):(role==='java-backend'?'我不清楚更底层的实现，但volatile保证可见性，count++仍是复合步骤；可用锁保护整个读改写。':'我不清楚所有实现细节，但响应提交要核对请求序号，旧响应不得修改当前结果和loading。');
  output={evidence:[{id:'new',excerpt:text}],criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score,evidenceIds:['new']})),feedback:{strengths:[],improvements:['离线流程反例，不证明模型能判断语义']}};
  const next={...input,answer:{id:'supplement-'+score,text:input.answer.text+'\n'+text},context:{...input.context,runId:'continued-'+role+'-'+score,attemptId:'next-'+score}};
  const result=await evaluateTurnWithClarification(next,{evaluate},{previous:first});expect(result.status).toBe('scored');if(result.status!=='scored')throw Error();
  expect(result.proposal.evaluation.normalizedScore).toBe(score/4);expect(result.proposal.nextState.observations).toHaveLength(1);expect(input.state.observations).toHaveLength(0);
 }
 output=missing;const repeated={...input,answer:{id:'still-missing',text:input.answer.text+'\n我还需要继续整理，暂未补充新的技术判断。'},context:{...input.context,runId:'repeat-'+role,attemptId:'repeat'}};
 const exhausted=await evaluateTurnWithClarification(repeated,{evaluate},{previous:first});expect(exhausted.status).toBe('abstained');if(exhausted.status==='scored')throw Error();expect(exhausted.reason).toBe('clarification_limit');expect(exhausted.normalizedScore).toBeNull();expect(exhausted.clarification).toBeNull();
 const near={...input,state:{...input.state,deadlineAt:now+20000}};const timed=await evaluateTurnWithClarification(near,{evaluate});expect(timed.status).toBe('abstained');if(timed.status==='scored')throw Error();expect(timed.reason).toBe('time_budget');expect(timed.normalizedScore).toBeNull();
 const before=sdk.stats.providerCalls;const explicit=await evaluateTurnWithClarification({...input,answer:{id:'unknown',text:'不知道。'}},{evaluate},{policy:{maxClarifications:0,minRemainingSeconds:45}});expect(explicit.status).toBe('abstained');expect(sdk.stats.providerCalls).toBe(before);
},15000);

test('a model workflow envelope is rejected, not stripped or mistaken for host clarification',async()=>{
 const sample=loadScoringQualityCases().find(c=>c.category==='insufficient')!,now=Date.now(),r=scoringQualityRequest(sample,now,now+30000,'root-envelope');if(r.job.type!=='turn')throw Error();
 const events:any[]=[],sdk=await createEvaluationFixture(()=>({text:JSON.stringify({evidence:[],criterionScores:r.job.type==='turn'?r.job.input.rubric.criteria.map(c=>({criterionId:c.id,score:null,evidenceIds:[]})):[],feedback:{strengths:[],improvements:['补充证据']},status:'needs_clarification'})}));
 await expect(evaluateTurnWithClarification(r.job.input,{evaluate:createPiEvaluator({cwd:process.cwd(),roleId:sample.roleId,modelRuntime:sdk.runtime,model:sdk.model,evidenceGrounding:'quoted-spans',onDiagnostic:e=>events.push(e)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 expect(events.some(d=>d.schemaIssue?.field==='root'&&d.schemaIssue.issue==='unrecognized_keys')).toBe(true);expect(sdk.stats.providerCalls).toBe(1);
});
