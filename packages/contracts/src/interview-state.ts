import { z } from 'zod';
import { KnowledgeItemSchema, RoleIdSchema } from './tools.ts';
import {consistentSkillScopes}from'./rubric-dimensions.ts';
const id = z.string().trim().min(1).max(100);
export const SkillSpecSchema = z.object({ skillId: id, relevance: z.number().min(0).max(1) }).strict();
const skills = z.array(SkillSpecSchema).min(1).max(30).refine((items) => new Set(items.map((item) => item.skillId)).size === items.length,
  'Skill identifiers must be unique.');
export const CreateInterviewStateSchema = z.object({
  sessionId: id, roleId: RoleIdSchema, durationMinutes: z.number().int().min(15).max(25), skills,
}).strict();
export const SkillObservationSchema = z.object({
  observationId: id, roleId: RoleIdSchema, skillId: id, questionId: id,
  questionType: KnowledgeItemSchema.shape.questionType, difficulty: KnowledgeItemSchema.shape.difficulty,
  score: z.number().min(0).max(1), quality: z.number().positive().max(1), observedAt: z.number().int().nonnegative(),
}).strict();
export type SkillObservation = z.infer<typeof SkillObservationSchema>;
export const HistoricalEvidenceSchema = SkillObservationSchema.extend({ sessionId: id, rubricId: id, rubricVersion: id,
  evidenceMode: z.enum(['offline-fixture', 'live-model', 'unverified']) }).strict();
export const InterviewStateSchema = z.object({
  schemaVersion: z.literal(1), sessionId: id, roleId: RoleIdSchema, version: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(), deadlineAt: z.number().int().nonnegative(), skills,
  observations: z.array(SkillObservationSchema).max(200), currentSkillId: id.nullable(),
  priorEvidence: z.array(HistoricalEvidenceSchema).max(4000).default([]),
  followupDepth: z.number().int().nonnegative(), difficulty: KnowledgeItemSchema.shape.difficulty,
}).strict().superRefine((state, ctx) => {
  const ids = new Set(state.skills.map((skill) => skill.skillId));
  let invalidHistory = false;
  const questionSkills = new Map<string, string>();
  state.priorEvidence.forEach((item,index) => {
    const previous = state.priorEvidence[index-1];
    if (item.roleId !== state.roleId || !ids.has(item.skillId) || item.observedAt >= state.startedAt
      || item.sessionId === state.sessionId || (previous && previous.observedAt > item.observedAt)
      || (questionSkills.has(item.questionId) && questionSkills.get(item.questionId) !== item.skillId)) invalidHistory = true;
    questionSkills.set(item.questionId,item.skillId);
  });
  if (new Set(state.priorEvidence.map(i => JSON.stringify([i.sessionId,i.observationId]))).size !== state.priorEvidence.length)
    invalidHistory = true;
  state.observations.forEach((item, index) => {
    const previous = state.observations[index - 1];
    const assignedSkill = questionSkills.get(item.questionId);
    if ((previous && item.observedAt < previous.observedAt) || (assignedSkill !== undefined && assignedSkill !== item.skillId))
      invalidHistory = true;
    questionSkills.set(item.questionId, item.skillId);
  });
  if (state.deadlineAt <= state.startedAt || (state.currentSkillId !== null && !ids.has(state.currentSkillId))
    || invalidHistory || !consistentSkillScopes([...state.priorEvidence,...state.observations])
    || new Set(state.observations.map((item) => item.observationId)).size !== state.observations.length
    || state.observations.some((item) => item.roleId !== state.roleId || !ids.has(item.skillId)
      || item.observedAt < state.startedAt || item.observedAt >= state.deadlineAt)) {
    ctx.addIssue({ code: 'custom', message: 'State references or time bounds are invalid.' });
  }
});
export type InterviewState = z.infer<typeof InterviewStateSchema>;
