import { pathToFileURL } from 'node:url';
import offline from '../apps/agent/src/model-access/offline.profile.json' with { type: 'json' };
import planned from '../apps/agent/src/model-access/live-planned.example.json' with { type: 'json' };
import { preflightModelAccess, ModelAccessError } from '../apps/agent/src/model-access/preflight.ts';
import { createModelBudgetGate } from '../apps/agent/src/model-access/budget.ts';
import { runBudgetedFixtureCall } from '../apps/agent/src/model-access/execute.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';

export async function runModelBudgetDemo(roleId: RoleId = 'java-backend') {
  const scope = { budgetId: 'offline-budget-demo', userId: 'fixture', roleId, runId: 'demo', attemptId: 'a', deadlineAt: Date.now() + 60000 };
  const gate = createModelBudgetGate(offline, scope);
  const request = (callId: string) => ({ scope, callId, payload: 'local synthetic prompt', planned: { inputTokens: 100, outputTokens: 40 } });
  let localInvocations = 0;
  await runBudgetedFixtureCall(gate, request('success'), async () => { localInvocations++; return { text: 'synthetic response', usage: { inputTokens: 50, outputTokens: 10, complete: true } }; });
  let unknownError = '';
  try { await runBudgetedFixtureCall(gate, request('unknown'), async () => { localInvocations++; throw new Error('simulated local dependency failure'); }); }
  catch (e) { if (!(e instanceof ModelAccessError)) throw e; unknownError = e.code; }
  const heldUnknown = gate.snapshot().totals;
  let blocked = '';
  try { gate.reserve('blocked', { inputTokens: 100, outputTokens: 40 }); }
  catch (e) { if (!(e instanceof ModelAccessError)) throw e; blocked = e.code; }
  // Explicit synthetic host reconciliation, not a vendor billing receipt.
  gate.settle('unknown', { inputTokens: 40, outputTokens: 5, complete: true });
  let overrunError = '';
  try { await runBudgetedFixtureCall(gate, request('overrun'), async () => { localInvocations++; return { text: 'overrun', usage: { inputTokens: 110, outputTokens: 10, complete: true } }; }); }
  catch (e) { if (!(e instanceof ModelAccessError)) throw e; overrunError = e.code; }
  const final = gate.snapshot();
  return { roleId, unknownError, blocked, heldUnknown, overrunError, final: { locked: final.locked, totals: final.totals },
    localInvocations, liveModelCalls: 0, metering: 'synthetic-host-reported', credentialInspection: 'not-performed', productionPublished: false };
}
export async function modelAccessMain(args: string[]) {
  if (args.length === 1 && args[0] === '--demo') {
    for (const role of ['java-backend', 'web-frontend'] as const) console.log(JSON.stringify(await runModelBudgetDemo(role)));
    return 0;
  }
  if (!(args.length === 0 || (args.length === 1 && args[0] === '--planned'))) throw new ModelAccessError('MODEL_CONFIG_INVALID');
  const result = preflightModelAccess(args.length ? planned : offline);
  console.log(JSON.stringify(result));
  return !result.configValid ? 2 : result.canExecuteFixture ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await modelAccessMain(process.argv.slice(2)); }
  catch (e) { console.error(e instanceof ModelAccessError ? e.code : 'MODEL_PREFLIGHT_FAILED'); process.exitCode = 2; }
}
