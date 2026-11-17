import { MemorySnapshotSchema, RecallMemorySchema, MemoryRecallSchema, MemoryRecallPolicySchema } from '../../../../packages/contracts/src/memory.ts';
import { InterviewStateSchema, type InterviewState, type HistoricalEvidenceSchema } from '../../../../packages/contracts/src/interview-state.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import type { z } from 'zod';
import {historyEligibility,sortHistoricalEvidence}from'./history-compatibility.ts';
type Evidence = z.infer<typeof HistoricalEvidenceSchema>;
export const projectMemoryForPrompt=(evidence:Evidence[])=>evidence.map(e=>({questionId:e.questionId,skillId:e.skillId,score:e.score,quality:e.quality,
  observedAt:e.observedAt,rubricId:e.rubricId,rubricVersion:e.rubricVersion,evidenceMode:e.evidenceMode}));
function select(evidence: Evidence[], skillIds: string[], now: number, rawPolicy: unknown,eligible:Set<string>,strict:boolean) {
  const p = MemoryRecallPolicySchema.safeParse(rawPolicy); if (!p.success) throw new AgentStateError('VALIDATION_ERROR');
  const policy = p.data, ids = new Set(skillIds), seen = new Set<string>(), excluded: z.infer<typeof MemoryRecallSchema>['excluded'] = [];
  const groups = new Map(skillIds.map(id => [id, [] as Evidence[]]));
  const exclude = (e: Evidence, reason: typeof excluded[number]['reason']) => excluded.push({ sessionId:e.sessionId, observationId:e.observationId, reason });
  // Match mastery independence: the first observation of a question is its anchor. A repeat cannot refresh its date.
  const ordered=strict?sortHistoricalEvidence(evidence):[...evidence].sort((a,b)=>a.observedAt-b.observedAt||(a.sessionId<b.sessionId?-1:a.sessionId>b.sessionId?1:0));
  for (const e of ordered) {
    if (seen.has(e.questionId)) { exclude(e,'duplicate'); continue; } seen.add(e.questionId);
    if (!ids.has(e.skillId)) { exclude(e,'irrelevant_skill'); continue; }
    if(e.assistance){exclude(e,'assisted_evidence');continue;}
    if(!eligible.has(e.questionId)){exclude(e,'rubric_incompatible');continue;}
    if (now-e.observedAt > policy.maxAgeDays*86400000) { exclude(e,'age'); continue; }
    groups.get(e.skillId)!.push(e);
  }
  for (const group of groups.values()) group.sort((a,b)=>b.observedAt-a.observedAt || a.questionId.localeCompare(b.questionId));
  const selected: Evidence[] = [];
  // Round-robin prevents one prolific skill from taking the entire context budget.
  const maxDepth = Math.max(0,...[...groups.values()].map(g=>g.length));
  for (let depth=0;depth<maxDepth;depth++) for (const skill of skillIds) {
    const e=groups.get(skill)![depth]; if(!e)continue;
    if(depth>=policy.maxPerSkill)exclude(e,'per_skill_limit'); else if(selected.length>=policy.maxItems)exclude(e,'item_limit'); else selected.push(e);
  }
  return MemoryRecallSchema.parse({kind:'uncommitted-memory-recall',selected,askedQuestionIds:[...seen].sort(),sourceCount:evidence.length,excluded});
}
export function recallMemory(rawMemory: unknown, rawRequest: unknown) {
  const m=MemorySnapshotSchema.safeParse(rawMemory), r=RecallMemorySchema.safeParse(rawRequest);
  if(!m.success||!r.success)throw new AgentStateError('VALIDATION_ERROR');
  if(m.data.userId!==r.data.userId)throw new AgentStateError('FORBIDDEN'); if(m.data.roleId!==r.data.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if(r.data.now<m.data.updatedAt)throw new AgentStateError('VALIDATION_ERROR');
  const evidence=m.data.sessions.flatMap(s=>s.observations);
  return select(evidence,r.data.skillIds,r.data.now,r.data.policy,historyEligibility(evidence,r.data.historyCompatibility).eligibleQuestionIds,!!r.data.historyCompatibility);
}
/** State is already bound to a trusted session by the host; this is a read-only projection, not authorization. */
export function recallStateEvidence(rawState: InterviewState, now: number, policy: unknown = {}) {
  const p=InterviewStateSchema.safeParse(rawState); if(!p.success||!Number.isSafeInteger(now)||now<p.data.startedAt)throw new AgentStateError('VALIDATION_ERROR');
  return select(p.data.priorEvidence,[...p.data.skills].sort((a,b)=>b.relevance-a.relevance || a.skillId.localeCompare(b.skillId)).map(s=>s.skillId),now,policy,
    historyEligibility(p.data.priorEvidence,p.data.historyCompatibility).eligibleQuestionIds,!!p.data.historyCompatibility);
}
