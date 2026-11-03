import { pathToFileURL } from 'node:url';
import { runPiInterviewDemo } from './demo-pi-interview.ts';
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
export async function runReportDemo(roleId: RoleId = 'java-backend') {
  const interview = await runPiInterviewDemo(roleId);
  return buildInterviewReport(interview.reportInput);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const role of ['java-backend', 'web-frontend'] as const) console.log(JSON.stringify(await runReportDemo(role), null, 2));
}
