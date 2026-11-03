import { canonical } from '../answers/validation.ts';
import { artifactHash, qualityIds, scenarioIds, sealDeliveryReport, type DeliveryReport, type DeliveryStage, type ArtifactName, type QualityId, type ScenarioId } from './report.ts';
import { runQuality } from './quality.ts';
import { collectDeliverySources } from './sources.ts';
import { emptyEvidence, runScenario, validateChecks, verifyChild, type ScenarioResult } from './scenarios.ts';
export type DeliveryOptions = { root: string; transport: DeliveryReport['transport']; checks: DeliveryReport['checks']; signal?: AbortSignal; stageTimeoutMs?: number; onStage?: (id: string) => void };
type Dependencies = { sources?: typeof collectDeliverySources; quality?: (id: QualityId, root: string, signal?: AbortSignal) => Promise<DeliveryStage>;
  scenario?: (id: ScenarioId, manifest: DeliveryReport['sourceManifest'], transport: DeliveryReport['transport']) => Promise<ScenarioResult> };
export async function runDelivery(options: DeliveryOptions, deps: Dependencies = {}) {
  const startedAt = new Date().toISOString(), sources = deps.sources ?? collectDeliverySources;
  const manifest = await sources(options.root), stages: DeliveryStage[] = [], evidence = emptyEvidence();
  const files: Partial<Record<ArtifactName, string>> = {};
  const skip = (id: QualityId | ScenarioId, why: 'cancelled' | 'scenarios-only'): DeliveryStage => ({ id, status: 'not_run', durationMs: 0, error: null, skippedBecause: why, exitCode: null, counts: null });
  for (const id of qualityIds) {
    options.onStage?.(id);
    if (options.signal?.aborted) stages.push(skip(id, 'cancelled'));
    else if (options.checks === 'scenarios-only') stages.push(skip(id, 'scenarios-only'));
    else stages.push(await (deps.quality ?? runQuality)(id, options.root, options.signal));
  }
  for (const id of scenarioIds) {
    options.onStage?.(id); if (options.signal?.aborted) { stages.push(skip(id, 'cancelled')); continue; }
    const start = performance.now(); let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    let error: DeliveryStage['error'] = null;
    try {
      const result = await Promise.race([(deps.scenario ?? runScenario)(id, manifest, options.transport), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('STEP_TIMEOUT')), options.stageTimeoutMs ?? 60000);
        abort = () => reject(new Error('STEP_CANCELLED')); options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      })]);
      const checks = validateChecks(id, result.checks);
      if (id === 'acceptance' || id === 'answers_development') {
        const flags = verifyChild(id, result.artifact, manifest, options.transport);
        if (flags.some((flag, i) => flag !== checks[i]?.passed)) throw new Error('Invalid child');
        files[id === 'acceptance' ? 'acceptance.json' : 'answers-development.json'] = JSON.stringify(result.artifact, null, 2) + '\n';
      }
      evidence[id] = checks; if (!checks.every(c => c.passed)) error = 'STEP_FAILED';
    } catch (e) { error = e instanceof Error && e.message === 'STEP_TIMEOUT' ? 'STEP_TIMEOUT' : e instanceof Error && e.message === 'STEP_CANCELLED' ? 'STEP_CANCELLED' : 'STEP_FAILED'; }
    finally { clearTimeout(timer); if (abort) options.signal?.removeEventListener('abort', abort); }
    stages.push({ id, status: error ? 'failed' : 'passed', durationMs: Math.round(performance.now() - start), error, skippedBecause: null, exitCode: null, counts: null });
  }
  options.onStage?.('source_integrity');
  let sourceStable = false;
  try { sourceStable = canonical(manifest) === canonical(await sources(options.root)); } catch { /* fail closed */ }
  stages.push({ id: 'source_integrity', status: sourceStable ? 'passed' : 'failed', durationMs: 0, error: sourceStable ? null : 'SOURCE_CHANGED', skippedBecause: null, exitCode: null, counts: null });
  files['scenarios.json'] = JSON.stringify(evidence, null, 2) + '\n';
  const artifacts = (Object.entries(files) as [ArtifactName, string][]).sort(([a], [b]) => a < b ? -1 : 1).map(([path, text]) => ({ path, sizeBytes: Buffer.byteLength(text), sha256: artifactHash(text) }));
  const report = sealDeliveryReport({ transport: options.transport, checks: options.checks, startedAt, finishedAt: new Date().toISOString(), sourceManifest: manifest, sourceStable, stages, artifacts });
  return { report, files };
}
