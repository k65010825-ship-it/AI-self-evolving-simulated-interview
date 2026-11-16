import {expect,test} from 'bun:test';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {groundQuotedEvaluation} from '../apps/agent/src/evaluation/quoted-spans.ts';
import {EvaluationDiagnosticSchema,type EvaluationDiagnostic} from '../packages/contracts/src/evaluation-diagnostic.ts';
import {ModelRecoveryPolicySchema} from '../packages/contracts/src/model-recovery.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {guidanceVersion} from '../apps/agent/src/harness/skills/evaluation-quotes.ts';

test('real SDK preserves sanitized shape across bounded regeneration without logging failed text',async()=>{
 const f=quotedFixture();let calls=0;const events:EvaluationDiagnostic[]=[];
 const sdk=await createEvaluationFixture(()=>({text:++calls===1?'{"private-key":"private-value':JSON.stringify(f.wire)}));
 const r=await evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans',
  recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs:1}),onDiagnostic:d=>events.push(d)})});
 expect(r.evaluation.normalizedScore).toBe(.75);expect(calls).toBe(2);
 expect(events).toContainEqual(expect.objectContaining({jsonIssue:'unclosed-structure',jsonShape:{scope:'raw',root:'object',containers:'open',stringState:'open',openDepth:'one',trailing:'unknown'}}));
 expect(JSON.stringify(events)).not.toContain('private');
});
test('real SDK and host scorer retain overlap fields without accepting or changing the invalid input',async()=>{
 const f=quotedFixture(),ground=groundQuotedEvaluation(f.wire,f.text);if(!ground.ok)throw Error('fixture');
 const output=ground.output,binding=output.criterionScores[0]!.verificationBinding!;binding.target=structuredClone(binding.action);
 output.feedback.improvements=['private-feedback'];const events:EvaluationDiagnostic[]=[],before=contentHash(f.input);
 const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(output)}));
 const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',onDiagnostic:d=>events.push(d)});
 await expect(evaluateTurn(f.input,{evaluate,onDiagnostic:d=>events.push(d)})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 expect(events).toContainEqual({version:1,stage:'scoring',outcome:'rejected',reason:'score-binding-invalid',bindingIssue:'span-overlap',bindingConflict:{parts:['action','target'],relation:'identical'}});
 expect(contentHash(f.input)).toBe(before);expect(sdk.stats.providerCalls).toBe(1);expect(JSON.stringify(events)).not.toContain('private');
});
test('old records remain valid while malformed diagnostic associations or unknown fields are refused',()=>{
 const old={version:1,stage:'scoring',outcome:'rejected',reason:'score-binding-invalid',bindingIssue:'span-overlap'};
 expect(EvaluationDiagnosticSchema.safeParse(old).success).toBe(true);
 expect(EvaluationDiagnosticSchema.safeParse({...old,bindingConflict:{parts:['metric','value'],relation:'identical'}}).success).toBe(false);
 expect(EvaluationDiagnosticSchema.safeParse({...old,bindingConflict:{parts:['private-key','target'],relation:'identical'}}).success).toBe(false);
 expect(EvaluationDiagnosticSchema.safeParse({...old,jsonShape:{scope:'raw',root:'object',containers:'open',stringState:'open',openDepth:'one',trailing:'unknown'}}).success).toBe(false);
});
test('structural guidance reaches the real SDK prompt and keeps quoted wire and zero-score acceptance',async()=>{
 const f=quotedFixture('java-backend',0);let observed=false;
 const sdk=await createEvaluationFixture(context=>{const wire=JSON.stringify(context);observed=wire.includes(guidanceVersion)&&wire.includes('pairwise non-overlapping')&&wire.includes('predicateAlias');return{text:JSON.stringify(f.wire)};});
 const p=await evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans'})});
 expect(observed).toBe(true);expect(p.evaluation.normalizedScore).toBe(0);expect(sdk.stats.providerCalls).toBe(1);
});
