import {test,expect} from 'bun:test';
import {createScoringExecutor} from '../apps/agent/src/tools/scoring-executor.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {groundQuotedEvaluation} from '../apps/agent/src/evaluation/quoted-spans.ts';

test('scoring reports fixed distinct refusal categories, never private keys or values',async()=>{
 const f=quotedFixture(),g=groundQuotedEvaluation(f.wire,f.text);if(!g.ok)throw Error('fixture');
 const valid=g.output.criterionScores;
 const cases=[['score-out-of-range',[{...valid[0]!,score:99}]],['score-evidence-unknown',[{...valid[0]!,evidenceIds:['private-unknown']}]],
 ['score-unknown-criterion',[{...valid[0]!,criterionId:'private-criterion'}]],['score-null-binding',[{...valid[0]!,score:null,evidenceIds:[]}]],
 ['score-binding-invalid',[{...valid[0]!,verificationBinding:{...valid[0]!.verificationBinding!,goalVersion:'private-stale'}}]]]as const;
 for(const [expected,scores]of cases){const events:unknown[]=[];
  const execute=createScoringExecutor({...f.input.context,answerId:f.input.answer.id,answerText:f.text,evidence:g.output.evidence},[f.input.rubric],{allowRequiredAbstention:true,onScoringRejection:(r:unknown)=>events.push(r)});
  const r=await execute('case',{rubricId:f.input.rubric.id,rubricVersion:'1',criterionScores:scores});expect(r.status).toBe('error');expect(events).toEqual([expected]);expect(JSON.stringify(events)).not.toContain('private');
 }
});

test('abstention, missing dimensions, required evidence and malformed inputs remain separate refusals',async()=>{
 const f=quotedFixture(),g=groundQuotedEvaluation(f.wire,f.text);if(!g.ok)throw Error('fixture');const v=g.output.criterionScores[0]!;
 for(const [reason,scores,allow]of [
  ['score-input-invalid',[{...v,score:-1}],true],['score-dimension-missing',[],true],
  ['score-required-missing',[{criterionId:v.criterionId,score:null,evidenceIds:[]}],false],
  ['score-abstention-evidence',[{criterionId:v.criterionId,score:null,evidenceIds:['unit']}],true],
  ['score-evidence-required',[{...v,evidenceIds:[]}],true],
 ]as const){const seen:unknown[]=[];const execute=createScoringExecutor({...f.input.context,answerId:f.input.answer.id,answerText:f.text,evidence:g.output.evidence},[f.input.rubric],{allowRequiredAbstention:allow,onScoringRejection:(r:unknown)=>seen.push(r)});
  expect((await execute('c',{rubricId:f.input.rubric.id,rubricVersion:'1',criterionScores:scores})).status).toBe('error');expect(seen).toEqual([reason]);
 }
});

test('throwing and asynchronously failing diagnostic observers cannot alter the score or leak errors',async()=>{
 const f=quotedFixture(),g=groundQuotedEvaluation(f.wire,f.text);if(!g.ok)throw Error('fixture');
 for(const callback of [()=>{throw Error('private-observer');},async()=>{throw Error('private-observer');}]){
  const execute=createScoringExecutor({...f.input.context,answerId:f.input.answer.id,answerText:f.text,evidence:g.output.evidence},[f.input.rubric],{onScoringRejection:callback});
  const r=await execute('bad',{rubricId:f.input.rubric.id,rubricVersion:'1',criterionScores:[{...g.output.criterionScores[0]!,score:99}]});expect(r.status).toBe('error');expect(JSON.stringify(r)).not.toContain('private');
 }
});
