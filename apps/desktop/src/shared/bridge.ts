import { z } from 'zod';
export const HealthSchema = z.object({
  service: z.enum(['api', 'agent']), stage: z.literal('scaffold'), liveModelConfigured: z.literal(false),
  capabilities: z.array(z.string()),
}).strict();
export type Health = z.infer<typeof HealthSchema>;
export type HealthResult = { ok: true; data: Health } | { ok: false; message: string };
export interface DesktopBridge { getVersion(): Promise<string>; getApiHealth(): Promise<HealthResult> }
