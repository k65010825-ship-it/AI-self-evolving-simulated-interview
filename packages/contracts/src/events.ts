import { z } from 'zod';
export const RunEventSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().min(1), attemptId: z.string().min(1), seq: z.number().int().nonnegative(),
  type: z.enum(['run.accepted', 'run.stage', 'question.delta', 'question.completed', 'run.completed', 'run.failed', 'run.cancelled']),
  payload: z.record(z.string(), z.unknown()), occurredAt: z.iso.datetime(),
}).strict();
export type RunEvent = z.infer<typeof RunEventSchema>;
// Dedicated payload schemas are required before each actual event is implemented.
