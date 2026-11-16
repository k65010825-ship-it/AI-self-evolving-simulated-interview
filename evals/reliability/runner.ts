import { collectDeliverySources } from '../delivery/sources.ts';
import { canonical } from '../answers/validation.ts';
import { caseIds, checkLabels, runReliabilityScenario, type CaseId, type ScenarioObservation } from './scenarios.ts';
import { sealReliabilityReport, type ReliabilityCase } from './report.ts';
export async function runReliabilitySuite(root: string, execute: (id: CaseId) => Promise<ScenarioObservation> = runReliabilityScenario) {
  const startedAt = new Date().toISOString(), sourceManifest = await collectDeliverySources(root), cases: ReliabilityCase[] = [];
  for (const id of caseIds) {
    const start = performance.now();
    try {
      const result = await execute(id);
      if (result.checks.length !== checkLabels[id].length) throw new Error('Invalid observation');
      const passed = result.checks.every(c => c === true);
      cases.push({ id, status: passed ? 'passed' : 'failed', durationMs: Math.round(performance.now() - start),
        checks: checkLabels[id].map((name, i) => ({ name, passed: result.checks[i] === true })), metrics: result.metrics, error: passed ? null : 'SCENARIO_FAILED' });
    } catch { cases.push({ id, status: 'failed', durationMs: Math.round(performance.now() - start), checks: null, metrics: null, error: 'SCENARIO_FAILED' }); }
  }
  let sourceStable = false; try { sourceStable = canonical(sourceManifest) === canonical(await collectDeliverySources(root)); } catch { /* fail closed */ }
  return sealReliabilityReport({ startedAt, finishedAt: new Date().toISOString(), sourceManifest, sourceStable, cases });
}
