import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAgentClient, AgentClientError } from '@interview/agent-client';
import { createRunManager } from '../apps/agent/src/runtime/run-manager.ts';
import { createAgentApp } from '../apps/agent/src/app.ts';
import { createServiceShutdown } from '../apps/agent/src/runtime/service-shutdown.ts';
import { reliabilityRequest, assessment, deferred, until } from '../evals/reliability/fixture.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
export async function runShutdownDemo(roleId: RoleId = 'java-backend', transport: 'tcp' | 'in-process' = 'tcp') {
  let entered = false, stopEntered = false, stopped = false;
  const allowStop = deferred<void>();
  const runtime = createRunManager({ evaluateForRole: () => async (_request, signal) => {
    entered = true; await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    return assessment('隔离甲一');
  } });
  let server: ReturnType<typeof Bun.serve> | undefined;
  const token = randomBytes(32).toString('hex'), app = createAgentApp({ runtime, internalToken: token });
  try {
    if (transport === 'tcp') server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
    const baseUrl = server ? `http://127.0.0.1:${server.port}` : 'http://agent.local';
    const client = createAgentClient({ baseUrl, internalToken: token, fetch: async (url, init) => {
      if (stopped) throw new Error('fixture transport stopped'); return server ? fetch(url, init) : app.request(new Request(url, init));
    } });
    const request = reliabilityRequest(`shutdown-${roleId}`, roleId); await client.startRun(request); await until(() => entered);
    const types: string[] = [], stream = (async () => { for await (const event of client.events(request.context.runId, { attemptId: request.context.attemptId })) types.push(event.type); })();
    // Attach a rejection handler before any assertion, including on a sandbox TCP failure.
    void stream.catch(() => {});
    await until(() => runtime.diagnostics().eventSubscribers === 1);
    const shutdown = createServiceShutdown({ runtime, stop: async () => { stopEntered = true; await allowStop.promise; stopped = true; await server?.stop(true); } }, { graceMs: 0, cancelWaitMs: 500, transportWaitMs: 1000 });
    const pending = shutdown(); await until(() => stopEntered); await stream;
    const snapshot = await client.getRun(request.context.runId, { attemptId: request.context.attemptId });
    let newRunError = '';
    try { await client.startRun(reliabilityRequest(`new-${roleId}`, roleId)); }
    catch (error) { if (!(error instanceof AgentClientError)) throw error; newRunError = error.code; }
    allowStop.resolve(); const service = await pending;
    let transportClosed = stopped;
    if (server) { try { await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) }); transportClosed = false; } catch { transportClosed = true; } }
    if (service.status !== 'stopped' || snapshot.status !== 'cancelled' || newRunError !== 'DEPENDENCY_UNAVAILABLE' || !types.includes('run.cancelled') || !transportClosed) throw new Error('SHUTDOWN_DEMO_FAILED');
    return { roleId, transport, service, runStatus: snapshot.status, newRunError, cancellationEvent: true, transportClosed,
      liveModelCalls: 0, formalCommitted: false, osSignalVerified: false };
  } finally { allowStop.resolve(); runtime.dispose(); await server?.stop(true); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2); if (args.length && !(args.length === 1 && args[0] === '--in-process')) throw new Error('SHUTDOWN_ARGS_INVALID');
    for (const role of ['java-backend', 'web-frontend'] as const) console.log(JSON.stringify(await runShutdownDemo(role, args.length ? 'in-process' : 'tcp')));
  } catch { console.error('SHUTDOWN_DEMO_FAILED'); process.exitCode = 1; }
}
