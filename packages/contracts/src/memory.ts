import { z } from 'zod';
import { RoleIdSchema } from './tools.ts';
import { HistoricalEvidenceSchema, CreateInterviewStateSchema } from './interview-state.ts';
import { ReportInputSchema } from './report.ts';
import{consistentSkillScopes}from'./rubric-dimensions.ts';
import{HistoryCompatibilityPolicySchema}from'./history-compatibility.ts';
const id = z.string().trim().min(1).max(100);
export const MemoryIdentitySchema = z.object({ userId:z.string().min(1),roleId:RoleIdSchema }).strict();
export const MemorySessionSchema = z.object({ sessionId:id,stateVersion:z.number().int().nonnegative(),endedAt:z.number().int().nonnegative(),
  acceptedAt:z.number().int().nonnegative(),
  policyVersion:id,evidenceMode:z.enum(['offline-fixture','live-model','unverified','mixed']),
  observations:z.array(HistoricalEvidenceSchema).max(200) }).strict();
export const MemorySnapshotSchema = z.object({schemaVersion:z.literal(1),kind:z.literal('uncommitted-memory-snapshot'),
  userId:z.string().min(1),roleId:RoleIdSchema,version:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),
  sessions:z.array(MemorySessionSchema).max(20) }).strict().superRefine((m,ctx)=>{
    let invalid=m.version!==m.sessions.length || new Set(m.sessions.map(s=>s.sessionId)).size!==m.sessions.length;
    const questions = new Map<string,string>();
    for(const [index,s] of m.sessions.entries()) {
      if(s.endedAt>s.acceptedAt || s.acceptedAt>m.updatedAt || (index>0 && m.sessions[index-1]!.endedAt>s.endedAt)
        || new Set(s.observations.map(o=>o.observationId)).size!==s.observations.length) invalid=true;
      for(const o of s.observations) {
        if(o.sessionId!==s.sessionId || o.roleId!==m.roleId || o.observedAt>s.endedAt
          || (questions.has(o.questionId)&&questions.get(o.questionId)!==o.skillId)) invalid=true;
        questions.set(o.questionId,o.skillId);
      }
    }
    if(invalid||!consistentSkillScopes(m.sessions.flatMap(s=>s.observations))) ctx.addIssue({code:'custom',message:'Invalid memory references, chronology, content scope or version.'});
  });
export const AppendMemorySchema = MemoryIdentitySchema.extend({expectedVersion:z.number().int().nonnegative(),
  sessionStatus:z.literal('completed'),now:z.number().int().nonnegative(),reportInput:ReportInputSchema}).strict();
export const StartSessionMemorySchema = MemoryIdentitySchema.extend({now:z.number().int().nonnegative(),session:CreateInterviewStateSchema}).strict();
export type MemorySnapshot = z.infer<typeof MemorySnapshotSchema>;
/** Read policy, never authority to persist or change past evidence. */
export const MemoryRecallPolicySchema = z.object({ maxItems:z.number().int().min(0).max(30).default(6),
  maxPerSkill:z.number().int().min(1).max(5).default(2), maxAgeDays:z.number().int().min(1).max(3650).default(90) }).strict();
export const RecallMemorySchema = MemoryIdentitySchema.extend({ now:z.number().int().nonnegative(),
  skillIds:z.array(id).min(1).max(30).refine(ids=>new Set(ids).size===ids.length),historyCompatibility:HistoryCompatibilityPolicySchema.optional(),
  policy:MemoryRecallPolicySchema.default({maxItems:6,maxPerSkill:2,maxAgeDays:90}) }).strict();
export const MemoryRecallSchema = z.object({ kind:z.literal('uncommitted-memory-recall'),
  selected:z.array(HistoricalEvidenceSchema).max(30), askedQuestionIds:z.array(id).max(4000), sourceCount:z.number().int().min(0).max(4000),
  excluded:z.array(z.object({sessionId:id,observationId:id,reason:z.enum(['duplicate','age','irrelevant_skill','per_skill_limit','item_limit','rubric_incompatible'])}).strict()).max(4000),
}).strict();
/** Safe count-only audit; business evidence references remain in the host. */
export const MemoryContextAuditSchema=z.object({strategy:z.literal('whole-evidence-projection-v1'),
 sourceCount:z.number().int().min(0).max(4000),selectedCount:z.number().int().min(0).max(30),includedCount:z.number().int().min(0).max(30),
 excludedCount:z.number().int().min(0).max(4000),reasonCounts:z.object({duplicate:z.number().int().nonnegative().optional(),age:z.number().int().nonnegative().optional(),
 irrelevant_skill:z.number().int().nonnegative().optional(),per_skill_limit:z.number().int().nonnegative().optional(),item_limit:z.number().int().nonnegative().optional(),
 context_budget:z.number().int().nonnegative().optional(),scoring_isolation:z.number().int().nonnegative().optional(),rubric_incompatible:z.number().int().nonnegative().optional()}).strict()}).strict().superRefine((a,ctx)=>{
 if(a.sourceCount!==a.includedCount+a.excludedCount||a.includedCount>a.selectedCount||a.selectedCount>a.sourceCount
  ||(a.reasonCounts.context_budget??0)+(a.reasonCounts.scoring_isolation??0)!==a.selectedCount-a.includedCount
  ||Object.values(a.reasonCounts).reduce<number>((n,v)=>n+(v??0),0)!==a.excludedCount)
  ctx.addIssue({code:'custom',message:'Invalid memory projection counts.'});
});
