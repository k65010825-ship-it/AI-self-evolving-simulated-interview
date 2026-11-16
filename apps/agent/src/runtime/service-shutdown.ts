import { z } from 'zod';
import { ShutdownOptionsSchema, type ShutdownReport } from './shutdown.ts';
import { AgentStateError } from '../planning/interview-state.ts';
const OptionsSchema = ShutdownOptionsSchema.extend({ transportWaitMs: z.number().int().min(1).max(5000).default(1000) });
export type ServiceShutdownReport = { status: 'stopped' | 'incomplete'; runtime: ShutdownReport | null;
  runtimeState: 'absent' | 'reported' | 'failed'; transport: 'closed' | 'timed_out' | 'failed'; scope: 'host-shutdown-not-process-exit' };
export function createServiceShutdown(host: { runtime?: { shutdown: (input: unknown) => Promise<ShutdownReport> }; stop: () => void | Promise<void> }, rawOptions: unknown = {}) {
  const parsed = OptionsSchema.safeParse(rawOptions); if (!parsed.success) throw new AgentStateError('VALIDATION_ERROR'); const options = parsed.data;
  let pending: Promise<ServiceShutdownReport> | undefined;
  return (): Promise<ServiceShutdownReport> => {
    if (pending) return pending;
    pending = (async () => {
      let runtime: ShutdownReport | null = null, runtimeState: ServiceShutdownReport['runtimeState'] = host.runtime ? 'reported' : 'absent';
      try { if (host.runtime) runtime = await host.runtime.shutdown({ graceMs: options.graceMs, cancelWaitMs: options.cancelWaitMs }); }
      catch { runtimeState = 'failed'; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let transport: ServiceShutdownReport['transport'];
      try {
        transport = await Promise.race([Promise.resolve().then(host.stop).then(() => 'closed' as const, () => 'failed' as const),
          new Promise<'timed_out'>(resolve => { timer = setTimeout(() => resolve('timed_out'), options.transportWaitMs); })]);
      } finally { clearTimeout(timer); }
      return Object.freeze({ status: transport === 'closed' && runtimeState !== 'failed' && (!runtime || runtime.status === 'drained') ? 'stopped' : 'incomplete',
        runtime, runtimeState, transport, scope: 'host-shutdown-not-process-exit' });
    })();
    return pending;
  };
}
type Signals = { on: (event: string, listener: () => void) => unknown; off: (event: string, listener: () => void) => unknown };
export function bindShutdownSignals(signals: Signals, shutdown: () => Promise<ServiceShutdownReport>, completed: (r: ServiceShutdownReport) => void, failed: () => void) {
  let called = false;
  const handler = () => { if (called) return; called = true; try { void shutdown().then(completed).catch(failed); } catch { failed(); } };
  signals.on('SIGINT', handler); signals.on('SIGTERM', handler);
  return () => { signals.off('SIGINT', handler); signals.off('SIGTERM', handler); };
}
