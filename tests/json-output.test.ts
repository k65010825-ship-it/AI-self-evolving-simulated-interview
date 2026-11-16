import {test,expect} from 'bun:test';
import {readEvaluationJson} from '../apps/agent/src/evaluation/read-json.ts';
import {fixtureAssessment} from '../experiments/pi-sdk/evaluation-fixture.ts';

test('plain JSON is unchanged and only explicit complete fenced-object repair is allowed',()=>{
 const raw=JSON.stringify(fixtureAssessment),fenced='```json\n'+raw+'\n```';
 expect(readEvaluationJson(raw,'none')).toEqual({ok:true,value:fixtureAssessment,repaired:false});
 expect(readEvaluationJson(fenced,'none')).toEqual({ok:false,jsonIssue:'fence-disabled'});
 expect(readEvaluationJson(fenced,'json-fence-only')).toEqual({ok:true,value:fixtureAssessment,repaired:true});
 expect(readEvaluationJson('  ```json\r\n'+raw+'\r\n```  ','json-fence-only')).toMatchObject({ok:true,repaired:true});
});

test('syntax and envelope diagnostics classify without reconstructing values or echoing model text',()=>{
 const cases=[['```json\n{}','unclosed-fence'],['```js\n{}\n```','unsupported-fence'],['说明\n```json\n{}\n```','surrounding-content'],
  ['{} {}','surrounding-content'],['{"a":','unclosed-structure'],['{"a":"unfinished','unclosed-structure'],['{"a":1,}','invalid-syntax'],["{'private-secret':1}",'invalid-syntax'],
  ['```json\n{"a":1,}\n```','fenced-syntax'],['```json\n[]\n```','non-object-root']]as const;
 for(const [text,jsonIssue]of cases){const r=readEvaluationJson(text,'json-fence-only');expect(r).toEqual({ok:false,jsonIssue});expect(JSON.stringify(r)).not.toContain('private');}
});

test('duplicate keys at any depth and escaped aliases reject instead of silently overwriting a score',()=>{
 for(const raw of ['{"score":0,"score":4}','{"nested":[{"score":0,"\\u0073core":4}]}','{"evidence":[],"evidence":["private"]}']){
  expect(readEvaluationJson(raw,'none')).toEqual({ok:false,jsonIssue:'duplicate-key'});
  expect(readEvaluationJson('```json\n'+raw+'\n```','json-fence-only')).toEqual({ok:false,jsonIssue:'duplicate-key'});
 }
 expect(readEvaluationJson('{"a":[{"score":0},{"score":4}],"literal":"{\\"score\\":0,\\"score\\":4}"}','none').ok).toBe(true);
});

test('deep valid JSON inspection is iterative and braces inside quoted strings are not structure',()=>{
 const raw='['.repeat(3000)+'0'+']'.repeat(3000);expect(readEvaluationJson(raw,'none').ok).toBe(true);
 expect(readEvaluationJson('{"text":"} [ \\\" \\\\"}','none').ok).toBe(true);
});
