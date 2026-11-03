import { pathToFileURL } from 'node:url';
import catalog from '../knowledge/resources.json' with { type: 'json' };
import { runReportDemo } from './demo-agent-report.ts';
import { recommendResources } from '../apps/agent/src/reporting/recommend-resources.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
export async function runResourcesDemo(roleId: RoleId = 'java-backend') {
  const report = await runReportDemo(roleId);
  return recommendResources(report, { userId: 'demo',runId:'resources-demo',attemptId:'demo',roleId,deadlineAt:Date.now()+60000 },
    catalog,{ allowDraftResources:true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const role of ['java-backend','web-frontend'] as const) console.log(JSON.stringify(await runResourcesDemo(role),null,2));
}
