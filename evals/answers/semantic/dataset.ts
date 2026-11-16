import raw from './references.json' with {type:'json'};
import { SemanticDatasetSchema,SemanticRequestSchema } from '../../../packages/contracts/src/semantic-evaluation.ts';
import { compileAnswerDataset,loadAnswerBundle,getBenchmarkKnowledge } from '../dataset.ts';
import { ScoringContextSchema } from '../../../packages/contracts/src/scoring.ts';
import { contentHash } from '../validation.ts';
export const loadSemanticDataset=()=>structuredClone(raw);
function invalid():never{throw new Error('SEMANTIC_DATASET_INVALID');}
export function compileSemanticDataset(input:unknown){
 const p=SemanticDatasetSchema.safeParse(input);if(!p.success)invalid();const b=p.data,base=compileAnswerDataset(loadAnswerBundle(),getBenchmarkKnowledge());
 if(b.baseDatasetDigest!==base.digest||new Set(b.claims.map(c=>c.id)).size!==b.claims.length)invalid();
 const requestHashes=new Set<string>();
 const samples=b.claims.map(c=>{
  const source=base.samples.find(s=>s.case.id===c.caseId);if(!source||source.case.split!=='development'||c.caseDigest!==contentHash(source.case)||c.rubricDigest!==contentHash(source.rubric))invalid();
  const criterion=source.rubric.criteria.find(x=>x.id===c.criterionId);if(!criterion||c.claimedScore>criterion.maxScore)invalid();
  if(new Set(c.quotes.map(q=>`${q.start}:${q.end}`)).size!==c.quotes.length)invalid();
  const quotes=c.quotes.map((q,i)=>({id:`citation-${i+1}`,start:q.start,end:q.end,excerpt:source.case.answer.slice(q.start,q.end)}));
  const literal=ScoringContextSchema.safeParse({userId:'semantic-fixture',roleId:source.question.roleId,runId:'semantic',attemptId:'a',deadlineAt:1,
   answerId:'answer',answerText:source.case.answer,evidence:quotes});if(!literal.success)invalid();
  const request=SemanticRequestSchema.parse({roleId:source.question.roleId,question:{text:source.question.text,skillId:source.question.skillId,questionType:source.question.questionType},
   answer:source.case.answer,rubric:{id:source.rubric.id,version:source.rubric.version,scope:source.rubric.scope},criterion,claimedScore:c.claimedScore,quotes});
  const hash=contentHash(request);if(requestHashes.has(hash))invalid();requestHashes.add(hash);
  return{id:c.id,roleId:source.question.roleId,sourceCaseId:c.caseId,groupId:source.case.groupId,request,reference:c.reference};
 });
 if(!['java-backend','web-frontend'].every(role=>samples.some(s=>s.roleId===role)))invalid();
 return{id:b.id,digest:contentHash(b),samples};
}

