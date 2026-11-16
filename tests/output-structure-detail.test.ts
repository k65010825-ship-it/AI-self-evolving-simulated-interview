import {expect,test} from 'bun:test';
import {describeEvaluationJsonShape,readEvaluationJson} from '../apps/agent/src/evaluation/read-json.ts';
test('minimal unclosed structures distinguish container, string and dangling escape without altering rejection',()=>{
 const cases=[['{"private":"x"','closed'],['{"private":"x','open'],['{"private":"x'+String.fromCharCode(92),'dangling-escape']] as const;
 for(const [raw,stringState] of cases){expect(readEvaluationJson(raw)).toEqual({ok:false,jsonIssue:'unclosed-structure'});
  expect(describeEvaluationJsonShape(raw)).toMatchObject({root:'object',containers:'open',openDepth:'one',stringState,scope:'raw'});}
});
test('balanced syntax failures, delimiter mismatch and trailing prose are distinct structural observations',()=>{
 expect(describeEvaluationJsonShape('{"x":1,}')).toMatchObject({containers:'balanced',stringState:'closed',trailing:'none'});
 expect(describeEvaluationJsonShape('{"x":[1}')).toMatchObject({containers:'mismatched',openDepth:'unknown'});
 expect(describeEvaluationJsonShape('{"x":1} private-text')).toMatchObject({trailing:'present'});
});
test('quoted delimiters and escapes do not change the stack or leak text, keys or offsets',()=>{
 const raw=JSON.stringify({'private-key':'a } [ " and '+String.fromCharCode(92)}),detail=describeEvaluationJsonShape(raw);
 expect(detail).toMatchObject({root:'object',containers:'balanced',stringState:'closed',openDepth:'zero',trailing:'none'});
 expect(JSON.stringify(detail)).not.toContain('private');expect(Object.keys(detail).sort()).toEqual(['containers','openDepth','root','scope','stringState','trailing']);
 expect(describeEvaluationJsonShape('```json\n{"private":1,}\n```')).toMatchObject({scope:'single-json-fence',containers:'balanced'});
 expect(readEvaluationJson('```json\n{"private":1,}\n```','json-fence-only')).toEqual({ok:false,jsonIssue:'fenced-syntax'});
});
