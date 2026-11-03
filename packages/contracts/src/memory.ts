import { z } from 'zod';
import { RoleIdSchema } from './tools.ts';
import { HistoricalEvidenceSchema, CreateInterviewStateSchema } from './interview-state.ts';
import { ReportInputSchema } from './report.ts';
import{consistentSkillScopes}from'./rubric-dimensions.ts';
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
