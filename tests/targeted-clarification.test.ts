import {test,expect} from 'bun:test';
import {TurnInputSchema} from '../packages/contracts/src/evaluation.ts';
import {createHash} from 'node:crypto';
import {conditionScopeScenario} from '../experiments/verification-binding/condition-fixture.ts';
import {observationScenario} from '../experiments/verification-binding/observation-fixture.ts';
import {evaluateTurnWithClarification,validateClarificationReceipt} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {NEUTRAL_CLARIFICATION_PROMPT,type UnscoredTurn} from '../packages/contracts/src/clarification.ts';
function rehash(r:UnscoredTurn){const {digest,...body}=r;r.digest=createHash('sha256').update(JSON.stringify(body)).digest('hex');}
for(const role of ['java-backend','web-frontend']as const)test(`${role}: local scope failure asks a fixed observation clarification with no extra inference`,async()=>{
 const f=conditionScopeScenario(role,'old');let calls=0;
 const r=await evaluateTurnWithClarification(f.input,{now:()=>f.at,evaluate:async()=>{calls++;return f.assessment;}});
 expect(r.status).toBe('needs_clarification');if(r.status==='scored')throw Error('expected unscored');
 expect(r.clarificationTemplate).toBe('observation-v1');expect(r.clarification).toContain('本次');expect(r.clarification).toContain('条件');
 expect(r.clarification).not.toContain(role==='java-backend'?'最多1':'下降20%');expect(calls).toBe(1);
 expect(f.input.state.observations).toEqual([]);validateClarificationReceipt(TurnInputSchema.parse(f.input),r);
 const forged=structuredClone(r);forged.clarification='正确答案是某方案，请照抄。';rehash(forged);
 expect(()=>validateClarificationReceipt(TurnInputSchema.parse(f.input),forged)).toThrow('VALIDATION_ERROR');
});
test('a versionless legacy neutral receipt remains valid for the same observation input',async()=>{
 const f=conditionScopeScenario('java-backend','old');const r=await evaluateTurnWithClarification(f.input,{now:()=>f.at,evaluate:async()=>f.assessment});if(r.status==='scored')throw Error('expected unscored');
 delete r.clarificationTemplate;r.clarification=NEUTRAL_CLARIFICATION_PROMPT;rehash(r);validateClarificationReceipt(TurnInputSchema.parse(f.input),r);
});
test('explicit non-answer stays neutral and cannot forge observation eligibility',async()=>{
 const f=observationScenario();const input={...f.input,answer:{id:'answer',text:'不知道'}};let calls=0;
 const r=await evaluateTurnWithClarification(input,{now:()=>f.at,evaluate:async()=>{calls++;return f.assessment;}});if(r.status==='scored')throw Error('expected unscored');
 expect(r.clarification).toBe(NEUTRAL_CLARIFICATION_PROMPT);expect(r.clarificationTemplate).toBeUndefined();expect(calls).toBe(0);
 r.clarificationTemplate='observation-v1';rehash(r);expect(()=>validateClarificationReceipt(TurnInputSchema.parse(input),r)).toThrow('VALIDATION_ERROR');
});
test('append-only clarification can reach one score; exhaustion and time pressure remain null',async()=>{
 const f=conditionScopeScenario('java-backend','old'),first=await evaluateTurnWithClarification(f.input,{now:()=>f.at,evaluate:async()=>f.assessment});if(first.status==='scored')throw Error('expected unscored');
 const valid=observationScenario(),prefix=f.input.answer.text+'\n',text=prefix+valid.input.answer.text;
 const shift=(p:{evidenceId:string;start:number;end:number})=>({...p,start:p.start+prefix.length,end:p.end+prefix.length});
 const b=valid.binding,binding={...b,action:shift(b.action),target:shift(b.target),expectation:shift(b.expectation),observation:{metric:shift(b.observation.metric),value:shift(b.observation.value),condition:shift(b.observation.condition)}};
 const input={...f.input,answer:{id:'answer-2',text},context:{...f.input.context,runId:'run-2',attemptId:'attempt-2'}};
 const output={...valid.assessment,evidence:[{id:'unit',start:prefix.length,end:text.length,excerpt:valid.input.answer.text}],criterionScores:[{...valid.assessment.criterionScores[0]!,verificationBinding:binding}]};
 const scored=await evaluateTurnWithClarification(input,{now:()=>f.at+1,evaluate:async()=>output},{previous:first});
 expect(scored.status).toBe('scored');if(scored.status==='scored')expect(scored.proposal.nextState.observations).toHaveLength(1);
 const limited=await evaluateTurnWithClarification(f.input,{now:()=>f.at,evaluate:async()=>f.assessment},{policy:{maxClarifications:0,minRemainingSeconds:45}});
 expect(limited.status).toBe('abstained');if(limited.status!=='scored'){expect(limited.clarification).toBeNull();expect(limited.clarificationTemplate).toBeUndefined();}
 const near=structuredClone(f.input);near.state.deadlineAt=f.at+30000;
 const timed=await evaluateTurnWithClarification(near,{now:()=>f.at,evaluate:async()=>f.assessment});
 expect(timed.status).toBe('abstained');if(timed.status!=='scored'){expect(timed.reason).toBe('time_budget');expect(timed.clarificationTemplate).toBeUndefined();}
});

test('mixed missing dimensions stay neutral and cannot claim observation-only focus',async()=>{
 const f=conditionScopeScenario('java-backend','old'),input=TurnInputSchema.parse(f.input);
 input.rubric.criteria[0]!.weight=.5;input.rubric.criteria.push({id:'logic',dimension:'logic',maxScore:4,weight:.5,required:true});
 const output={...f.assessment,criterionScores:[...f.assessment.criterionScores,{criterionId:'logic',score:null,evidenceIds:[]}]};
 const r=await evaluateTurnWithClarification(input,{now:()=>f.at,evaluate:async()=>output});if(r.status==='scored')throw Error('expected unscored');
 expect(r.clarification).toBe(NEUTRAL_CLARIFICATION_PROMPT);expect(r.clarificationTemplate).toBeUndefined();
});
