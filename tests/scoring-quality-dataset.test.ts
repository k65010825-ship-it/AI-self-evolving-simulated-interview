import {test,expect} from 'bun:test';
import {loadScoringQualityCases,scoringQualityRequest} from '../evals/scoring-quality/dataset.ts';

test('both roles have normal, insufficient, abstention and verification cases with isolated draft references',()=>{
 const cases=loadScoringQualityCases();expect(cases).toHaveLength(8);
 for(const role of ['java-backend','web-frontend']){
  const rows=cases.filter(c=>c.roleId===role);expect(rows.map(c=>c.category).sort()).toEqual(['abstention','insufficient','normal','verification']);
  for(const c of rows){expect(c.reference.origin).toBe('assistant-authored-draft');
   expect(c.reference.bands.length).toBe(c.expectedOutcome==='scored'?c.item.rubric.length:0);
   expect(c.item.rubric.some(r=>r.verificationGoal)).toBe(c.category==='verification');
  }
 }
});
test('scoring requests contain question/rubric/answer but no category, reference or score bands',()=>{
 const startedAt=Date.now();
 for(const c of loadScoringQualityCases()){
  const request=scoringQualityRequest(c,startedAt,startedAt+30000,'r-'+c.id);
  expect(request.job.type).toBe('turn');const wire=JSON.stringify(request);
  expect(wire).not.toContain(c.reference.rationale);expect(wire).not.toContain('assistant-authored-draft');expect(wire).not.toContain('bands');
  if(request.job.type==='turn'){expect(request.job.input.answer.text).toBe(c.answer);expect(request.job.knowledge).toEqual([]);expect(request.job.input.knowledge).toEqual([]);}
 }
});
