import { z } from 'zod';
import { AgentStateError } from '../planning/interview-state.ts';
export const ShutdownOptionsSchema = z.object({ graceMs: z.number().int().min(0).max(30000).default(5000),
  cancelWaitMs: z.number().int().min(0).max(10000).default(2000) }).strict();
const count = z.number().int().nonnegative();
export const ResourceCountsSchema = z.object({ activeRuns: count, occupiedSlots: count, inFlightDependencies: count, pendingWork: count,
  deadlineTimers: count, eventSubscribers: count, retainedRuns: count }).strict();
export const ShutdownReportSchema = z.object({ status: z.enum(['drained', 'incomplete']), graceMs: count, cancelWaitMs: count,
  elapsedMs: count, cancelledRuns: count, remaining: ResourceCountsSchema, formalCommitted: z.literal(false),
  scope: z.literal('host-observed-resources-only') }).strict();
export type ShutdownReport = z.infer<typeof ShutdownReportSchema>;
type Resources = z.infer<typeof ResourceCountsSchema>;
export function resourcesEmpty(r: Resources) { return !r.activeRuns && !r.occupiedSlots && !r.inFlightDependencies && !r.pendingWork && !r.deadlineTimers && !r.eventSubscribers; }
export function createRuntimeShutdown(host: { closeAdmission: () => void; cancelActive: () => number; resources: () => Resources }) {
  let pending: Promise<ShutdownReport> | undefined;
  async function wait(ms: number) {
    const end = performance.now() + ms;
    while (!resourcesEmpty(host.resources())) {
      const remaining = end - performance.now(); if (remaining <= 0) return;
      await new Promise(r => setTimeout(r, Math.min(5, remaining)));
    }
  }
  return (raw: unknown = {}): Promise<ShutdownReport> => {
    const p = ShutdownOptionsSchema.safeParse(raw); if (!p.success) throw new AgentStateError('VALIDATION_ERROR');
    if (pending) return pending;
    host.closeAdmission(); // Synchronous: no start can slip in before the first await.
    pending = (async () => {
      const started = performance.now(); await wait(p.data.graceMs);
      const cancelledRuns = host.cancelActive(); await wait(p.data.cancelWaitMs);
      const remaining = ResourceCountsSchema.parse(host.resources());
      const r = ShutdownReportSchema.parse({ ...p.data, elapsedMs: Math.round(performance.now() - started), cancelledRuns, remaining,
        status: resourcesEmpty(remaining) ? 'drained' : 'incomplete', scope: 'host-observed-resources-only', formalCommitted: false });
      Object.freeze(r.remaining); return Object.freeze(r);
    })();
    return pending;
  };
}
