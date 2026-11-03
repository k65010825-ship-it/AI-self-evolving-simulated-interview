import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAgentApp } from '../apps/agent/src/app.ts';
import { createOfflineRunManager } from '../apps/agent/src/runtime/offline-runtime.ts';
import { AgentRunEventSchema, AgentRunSnapshotSchema } from '../packages/contracts/src/agent-run.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
import { runPiInterviewDemo } from './demo-pi-interview.ts';
import java from '../knowledge/java-backend/seed.json' with { type: 'json' };
import web from '../knowledge/web-frontend/seed.json' with { type: 'json' };
import { makeSpeechFixture } from '../experiments/speech/fixture.ts';
import { transcribeSpeech } from '../apps/agent/src/speech/transcribe.ts';
import { confirmSpeechAnswer } from '../apps/agent/src/speech/confirm.ts';
import type { TurnInput } from '../packages/contracts/src/evaluation.ts';

/** Real local TCP + Pi SDK, deterministic provider. No paid model or formal commit. */
export async function runAgentRuntimeDemo(roleId: RoleId = 'java-backend',options:{speech?:boolean;planner?:boolean}={}) {
  const source = await runPiInterviewDemo(roleId);
  const runtime = await createOfflineRunManager({planning:options.planner?'pi-knowledge':'deterministic'});
  const token = randomBytes(32).toString('hex'); // Service credential, never log it.
  const app = createAgentApp({ runtime, internalToken: token });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const url = `http://127.0.0.1:${server.port}/internal/v1/runs`;
  try {
    const first = source.reportInput.turns[0]!;
    const context = { ...first.input.context, runId: `runtime-${roleId}`, attemptId: 'attempt-1', deadlineAt: Date.now() + 60000 };
    let input:TurnInput = { ...first.input, context };
    if(options.planner)input={...input,planningPolicy:{id:'runtime-knowledge-v1',roleId,parameters:{maxFollowupDepth:0,maxTurns:12,wrapUpSeconds:30}}};
    if(options.speech){
      const fixture=makeSpeechFixture(roleId);
      const transcript=await transcribeSpeech({...fixture.input,context},{provider:fixture.provider});
      const speech=confirmSpeechAnswer(transcript,{transcriptionId:transcript.transcriptionId,audioSha256:transcript.audio.sha256,
        userId:context.userId,roleId,answerId:input.answer.id,text:fixture.text+'，这是确认后的补充说明。',confirmedAt:Date.now()});
      input={...input,answer:speech.answer,speech};
    }
    const body = { inputSnapshotId: 'runtime-snapshot', context, job: { type: 'turn', input,
      knowledge: roleId === 'java-backend' ? java : web, askedQuestionIds: [input.question.id], allowDraftKnowledge: true } };
    const accepted = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (accepted.status !== 202) throw new Error(`Runtime HTTP rejected: ${accepted.status}`);
    const eventsResponse = await fetch(`${url}/${context.runId}/events`, { headers });
    if (!eventsResponse.ok) throw new Error(`Runtime SSE rejected: ${eventsResponse.status}`);
    const events = (await eventsResponse.text()).split('\n').filter(line => line.startsWith('data:'))
      .map(line => AgentRunEventSchema.parse(JSON.parse(line.slice(5).trim())));
    const snapshot = AgentRunSnapshotSchema.parse(await (await fetch(`${url}/${context.runId}`, { headers })).json());
    if (snapshot.result?.kind !== 'uncommitted-turn-result') throw new Error('Expected completed turn candidate');
    const proposal = snapshot.result.proposal;
    const reportContext = { ...context, runId: `report-${roleId}` };
    const reportBody = { inputSnapshotId: 'report-snapshot', context: reportContext, job: { type: 'report', input: {
      ...source.reportInput, policyVersion:input.planningPolicy?.id??source.reportInput.policyVersion,state: proposal.nextState, generatedAt: Date.now(),
      turns: [{ input, proposal, evidenceMode: 'offline-fixture' }] } } };
    const reportAccepted = await fetch(url, { method: 'POST', headers, body: JSON.stringify(reportBody) });
    if (reportAccepted.status !== 202) throw new Error(`Report HTTP rejected: ${reportAccepted.status}`);
    const reportStream = await fetch(`${url}/${reportContext.runId}/events`, { headers });
    if (!reportStream.ok) throw new Error('Report SSE rejected');
    await reportStream.text();
    const report = AgentRunSnapshotSchema.parse(await (await fetch(`${url}/${reportContext.runId}`, { headers })).json());
    if (report.result?.kind !== 'uncommitted-report-result') throw new Error('Expected completed report candidate');
    return { roleId, mode: 'local-tcp-real-pi-fixture', liveModelCalls: 0, committed: false,
      turnStatus: snapshot.status, reportStatus: report.status, eventTypes: events.map(event => event.type),
      eventSequences: events.map(event => event.seq), reportKind: report.result.report.kind,
      expressionStatus:report.result.report.expression.status,
      planningToolCalls:snapshot.result.planning?.receipts.length??0,
      planningModelMessages:snapshot.result.planning?.modelMessages??0,
      ...(report.result.report.expression.status==='audio_descriptions'?{
        speechEvidenceMode:report.result.report.expression.speechEvidenceMode,
        speechCoverage:report.result.report.expression.coverage,
        originalUnitsPerMinute:report.result.report.expression.answers[0]!.features.unitsPerMinute,
        confirmedTextMatches:report.result.report.expression.answers[0]!.confirmedText===input.answer.text,
        audioSource:'generated-sine-and-silence',asrSource:'hand-authored-transcript',
      }:{}) };
  } finally {
    runtime.dispose();
    await server.stop(true);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const roleId of ['java-backend', 'web-frontend'] as const) console.log(JSON.stringify(await runAgentRuntimeDemo(roleId), null, 2));
}
