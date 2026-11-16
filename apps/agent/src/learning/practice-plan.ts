import { MemorySnapshotSchema } from '../../../../packages/contracts/src/memory.ts';
import { PracticeGoalsRequestSchema, PracticeGoalsSchema } from '../../../../packages/contracts/src/learning-planning.ts';
import { startSessionFromMemory } from '../memory/session-memory.ts';
import { recallStateEvidence } from '../memory/recall.ts';
import { estimateSkills } from '../planning/interview-state.ts';
import { rankSkills } from '../../../../packages/interview-domain/src/planning.ts';
import { parseLearning } from './progress.ts';
/** Read-only host advice. Does not create assignments, complete learning or change interview policy. */
export function buildPracticeGoals(rawMemory:unknown,rawRequest:unknown){
 const memory=parseLearning(MemorySnapshotSchema,rawMemory),r=parseLearning(PracticeGoalsRequestSchema,rawRequest);
 const state=startSessionFromMemory(memory,{userId:r.userId,roleId:r.roleId,session:r.session,now:r.now});
 const estimates=estimateSkills(state,r.now),recall=recallStateEvidence(state,r.now,{maxItems:30,maxPerSkill:5,maxAgeDays:90});
 const goals=rankSkills(estimates,(state.deadlineAt-r.now)/1000).filter(s=>s.relevance>0&&(s.mastery===null||s.mastery<.6||s.confidence<.5)).slice(0,r.maxGoals)
  .map(s=>({skillId:s.skillId,mastery:s.mastery,confidence:s.confidence,priority:s.priority,
   reason:s.mastery===null?'no_evidence' as const:s.mastery<.6?'weak_evidence' as const:'uncertain_evidence' as const,
   evidence:recall.selected.filter(e=>e.skillId===s.skillId)}));
 return PracticeGoalsSchema.parse({kind:'uncommitted-practice-goals',userId:r.userId,roleId:r.roleId,sessionId:state.sessionId,
  memoryVersion:memory.version,plannedAt:r.now,goals,excludedQuestionIds:[...new Set(memory.sessions.flatMap(s=>s.observations.map(o=>o.questionId)))].sort()});
}
