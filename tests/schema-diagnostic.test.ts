import {test,expect} from 'bun:test';
import {schemaFailureDetails} from '../apps/agent/src/evaluation/schema-diagnostic.ts';
import {fixtureAssessment} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {EvaluationDiagnosticSchema} from '../packages/contracts/src/evaluation-diagnostic.ts';

test('schema diagnostics identify nullable optional binding without exposing scores or raw values',()=>{
 const output={...fixtureAssessment,criterionScores:fixtureAssessment.criterionScores.map(c=>({...c,verificationBinding:null}))};
 const details=schemaFailureDetails(output);
 expect(details).toContainEqual({field:'criterionScores.verificationBinding',issue:'invalid_type',receivedType:'null'});
 expect(details.length).toBeLessThanOrEqual(4);
 expect(EvaluationDiagnosticSchema.safeParse({version:1,stage:'schema',outcome:'rejected',reason:'invalid-schema',schemaIssue:details[0]}).success).toBe(true);
});

test('untrusted keys, literal values and messages never enter schema diagnostics',()=>{
 const output={...fixtureAssessment,feedback:{strengths:['private-model-text'],improvements:[]},'private-key-name':'private-secret-value'};
 const details=schemaFailureDetails(output),serialized=JSON.stringify(details);
 expect(details.some(d=>d.field==='root'&&d.issue==='unrecognized_keys')).toBe(true);
 expect(details.some(d=>d.field==='feedback.improvements'&&d.issue==='too_small')).toBe(true);
 expect(serialized).not.toContain('private');expect(details.every(d=>Object.keys(d).length===3)).toBe(true);
 expect(schemaFailureDetails(fixtureAssessment)).toEqual([]);
});
