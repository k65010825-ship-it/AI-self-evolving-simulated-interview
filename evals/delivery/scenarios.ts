import { z } from 'zod';
import offline from '../../apps/agent/src/model-access/offline.profile.json' with { type: 'json' };
import planned from '../../apps/agent/src/model-access/live-planned.example.json' with { type: 'json' };
import { preflightModelAccess } from '../../apps/agent/src/model-access/preflight.ts';
import { loadKnowledgeWorkspace } from '../../apps/agent/src/knowledge/catalog.ts';
import { buildKnowledgeCatalog } from '../../apps/agent/src/knowledge/curation.ts';
import { runCuratedKnowledgeDemo } from '../../scripts/demo-curated-knowledge.ts';
import { runModelBudgetDemo } from '../../scripts/model-access.ts';
import { runWorkflowCommitDemo } from '../../scripts/demo-workflow-commit.ts';
import { runAcceptanceSuite } from '../acceptance/run-suite.ts';
import { verifyAcceptanceReport } from '../acceptance/report.ts';
import { runOfflineAnswerBenchmark } from '../answers/runner.ts';
import { compileAnswerDataset, getBenchmarkKnowledge, loadAnswerBundle } from '../answers/dataset.ts';
import { verifyAnswerReport } from '../answers/metrics.ts';
import { scenarioIds, type ScenarioId, type DeliveryReport, invalid } from './report.ts';
export const checkNames = {
  model_preflight: ['offline-declared', 'live-disabled', 'no-credential-inspection'],
  knowledge_catalog: ['two-roles', 'catalog-valid', 'draft-not-reviewed'],
  curated_knowledge: ['two-roles', 'sdk-tool-selection', 'reviewed-only-closed', 'zero-live-calls'],
  budget: ['two-roles', 'unknown-held', 'concurrency-blocked', 'overrun-locked', 'synthetic-metering'],
  acceptance: ['twelve-cases-passed', 'transport-matches'],
  answers_development: ['development-only', 'six-completed', 'draft-not-quality'],
  workflow_commit: ['two-roles', 'cas-conflict', 'replay-idempotent', 'completed-not-formal'],
} as const;
const check = z.object({ name: z.string().regex(/^[a-z-]+$/).max(60), passed: z.boolean() }).strict();
export const ScenarioEvidenceSchema = z.object(Object.fromEntries(scenarioIds.map(id => [id, z.array(check).min(1).max(8).nullable()])) as Record<ScenarioId, z.ZodNullable<z.ZodArray<typeof check>>>).strict();
export type ScenarioEvidence = z.infer<typeof ScenarioEvidenceSchema>;
export type ScenarioResult = { checks: z.infer<typeof check>[]; artifact?: unknown };
export const emptyEvidence = (): ScenarioEvidence => Object.fromEntries(scenarioIds.map(id => [id, null])) as ScenarioEvidence;
export function validateChecks(id: ScenarioId, raw: unknown) {
  const parsed = z.array(check).parse(raw);
  if (parsed.map(c => c.name).join() !== checkNames[id].join()) invalid();
  return parsed;
}
export function answerDataset() { return compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge()); }
export function verifyChild(id: ScenarioId, raw: unknown, manifest: DeliveryReport['sourceManifest'], transport: DeliveryReport['transport']) {
  if (id === 'acceptance') {
    const r = verifyAcceptanceReport(raw, manifest); return [r.summary.passed === 12 && r.summary.failed === 0, r.transport === transport];
  }
  if (id === 'answers_development') {
    const r = verifyAnswerReport(raw, answerDataset());
    return [r.split === 'development', r.rows.length === 6 && r.rows.every(row => row.status === 'completed'),
      !r.analysis.qualityClaimEligible && r.analysis.humanReferenceCount === 0];
  }
  invalid();
}
/** Only fixed scalar checks leave this boundary; no question/answer/rubric bodies or error text. */
export async function runScenario(id: ScenarioId, manifest: DeliveryReport['sourceManifest'], transport: DeliveryReport['transport']): Promise<ScenarioResult> {
  const roles = ['java-backend', 'web-frontend'] as const;
  let flags: boolean[], artifact: unknown;
  switch (id) {
    case 'model_preflight': {
      const a = preflightModelAccess(offline), b = preflightModelAccess(planned);
      flags = [a.configValid && a.canExecuteFixture, b.configValid && !b.canExecuteLive && !a.canExecuteLive,
        a.credentialInspection === 'not-performed' && b.credentialInspection === 'not-performed']; break;
    }
    case 'knowledge_catalog': {
      const c = buildKnowledgeCatalog(loadKnowledgeWorkspace(), { mode: 'draft-preview' });
      flags = [roles.every(role => c.items.some(i => i.roleId === role)), c.summary.total === 29 && c.summary.readyForHumanReview === 22,
        c.summary.reviewed === 0 && c.items.every(i => i.reviewStatus === 'draft')]; break;
    }
    case 'curated_knowledge': {
      const rs = await Promise.all(roles.map(role => runCuratedKnowledgeDemo(role)));
      flags = [rs.length === 2, rs.every(r => r.preview.selection.status === 'selected' && r.preview.receipts.length === 1),
        rs.every(r => r.closed.selection.status === 'unavailable'), rs.every(r => r.liveModelCalls === 0)]; break;
    }
    case 'budget': {
      const rs = await Promise.all(roles.map(role => runModelBudgetDemo(role)));
      flags = [rs.length === 2, rs.every(r => r.unknownError === 'MODEL_DEPENDENCY_FAILED' && r.heldUnknown.activeSlots === 1 && r.heldUnknown.heldTokens > 0),
        rs.every(r => r.blocked === 'MODEL_CONCURRENCY_EXCEEDED'), rs.every(r => r.overrunError === 'MODEL_USAGE_OVERRUN' && r.final.locked),
        rs.every(r => r.metering === 'synthetic-host-reported' && r.liveModelCalls === 0 && r.localInvocations === 3)]; break;
    }
    case 'acceptance': artifact = await runAcceptanceSuite({ transport, manifest }); flags = verifyChild(id, artifact, manifest, transport); break;
    case 'answers_development': artifact = await runOfflineAnswerBenchmark('development'); flags = verifyChild(id, artifact, manifest, transport); break;
    case 'workflow_commit': {
      const rs = await Promise.all(roles.map(role => runWorkflowCommitDemo(role, transport)));
      flags = [rs.length === 2, rs.every(r => r.raceError === 'COMMIT_VERSION_CONFLICT'),
        rs.every(r => r.revisionHistory.join() === '0,1,2,3,4,5,5,5' && r.storageVersionHistory.join() === '0,1,2,3,4,5,6,7' && r.lostAck === 'replayed-in-memory'),
        rs.every(r => r.phase === 'completed' && !r.formalCommitted && r.liveModelCalls === 0)]; break;
    }
  }
  return { checks: checkNames[id].map((name, i) => ({ name, passed: flags[i] === true })), ...(artifact ? { artifact } : {}) };
}
