import {expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {contentText} from '../experiments/pi-sdk/planner-fixture.ts';
import modelConfig from '../apps/agent/src/model-access/bailian.example.json' with {type: 'json'};

type Host = Awaited<ReturnType<typeof createLocalHost>>;
type Transcript = {status: string; version: number; transcript?: {originalText: string}};
const secret = 'synthetic-local-speech-boundary-key';
const config = {...modelConfig, planning: 'pi-knowledge', questionDelivery: 'canonical', profile: {
  ...modelConfig.profile, limits: {...modelConfig.profile.limits, maxCalls: 12, maxTotalTokens: 200000, maxCostMicros: 1000000},
}};
function policy() {
  return {
    asrConfig: {version: 1, enabled: true, providerId: 'bailian', modelId: 'qwen3-asr-flash',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', credentialEnv: 'INTERVIEW_BAILIAN_ASR_API_KEY',
      timeoutMs: 1000, authorization: {allowLive: true, expiresAt: Date.now() + 60000},
      budget: {maxCalls: 6, maxTotalAudioMs: 120000, maxCostMicros: 1000000, reserveCostMicrosPerCall: 10000}},
    ttsConfig: {enabled: false, endpoint: 'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',
      model: 'qwen3-tts-flash', voice: 'Cherry', credentialEnv: 'INTERVIEW_BAILIAN_ASR_API_KEY'},
    asrBudget: {maxCalls: 6, maxAudioMs: 120000, maxCostMicros: 1000000, reserveCostMicrosPerCall: 10000},
    ttsBudget: {maxCalls: 6, maxCharacters: 6000, maxCostMicros: 1000000, reserveCostMicrosPerCall: 10000},
    totalMaxCostMicros: 3000000,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {resolve = r;});
  return {promise, resolve};
}
function stream(delta: unknown, reason = 'stop') {
  return new Response('data: ' + JSON.stringify({choices: [{index: 0, delta, finish_reason: reason}]}) +
    '\n\ndata: ' + JSON.stringify({choices: [], usage: {prompt_tokens: 100, completion_tokens: 30, total_tokens: 130}}) +
    '\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
}
async function modelSuccess(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const body = await new Request(input, init).json() as any;
  const tool = body.messages.find((m: any) => m.role === 'tool');
  if (tool) return stream({content: JSON.stringify({questionId: JSON.parse(contentText(tool.content)).data.items[0].id})});
  const p = JSON.parse(contentText(body.messages.find((m: any) => m.role === 'user').content));
  if (p.rubric) {
    const text = p.interview.answer.text;
    return stream({content: JSON.stringify({evidence: [{id: 'e', start: 0, end: 4, excerpt: text.slice(0, 4)}],
      criterionScores: p.rubric.criteria.map((c: any) => ({criterionId: c.id, score: c.maxScore / 2, evidenceIds: ['e']})),
      feedback: {strengths: ['合成反馈'], improvements: ['待人工审核']}})});
  }
  return stream({tool_calls: [{index: 0, id: 'knowledge', type: 'function', function: {
    name: 'query_role_knowledge', arguments: JSON.stringify({skillId: p.plan.skillId, limit: 3}),
  }}]}, 'tool_calls');
}
function asrResponse() {
  return new Response(JSON.stringify({choices: [{index: 0, finish_reason: 'stop', message: {
    role: 'assistant', content: '合成转写回答：我会明确事务边界，并验证失败后的回滚行为。',
  }}], usage: {prompt_tokens: 3, completion_tokens: 4, total_tokens: 7}}));
}
async function question(h: Host) {
  const c = h.command('session.create', {operationId: 'create', roleId: 'java-backend', goal: '合成语音错误边界验收',
    durationMinutes: 20, mode: 'live', liveConfig: config, sessionBudget: {
      maxCalls: 12, maxTotalTokens: 200000, maxCostMicros: 1000000,
    }, speech: policy()});
  await h.wait(c.jobId);
  expect(h.job(c.jobId).status).toBe('completed');
  h.authorize({sessionId: c.sessionId, grantId: 'model-grant', expectedVersion: 0,
    expiresAt: Date.now() + 60000, credentialRef: 'synthetic-model-ref', profile: config.profile});
  const q = h.command('session.nextQuestion', {operationId: 'question', sessionId: c.sessionId, expectedRevision: 0});
  await h.wait(q.jobId);
  expect(h.job(q.jobId).status).toBe('completed');
  return c.sessionId;
}
function authorizeSpeech(h: Host, sessionId: string) {
  h.speech('speech.authorize', {sessionId, capability: 'asr', grantId: 'asr-grant', expectedVersion: 0,
    credentialRef: 'synthetic-asr-ref', expiresAt: Date.now() + 60000});
}
function upload(h: Host, sessionId: string) {
  const wav = Buffer.alloc(3244);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3200, 40);
  const up = h.speech('speech.upload.begin', {operationId: 'upload', sessionId, expectedRevision: 1,
    byteLength: wav.length, sha256: createHash('sha256').update(wav).digest('hex')}) as {audioId: string};
  h.speech('speech.upload.chunk', {audioId: up.audioId, index: 0, base64: wav.toString('base64')});
  h.speech('speech.upload.finish', {audioId: up.audioId});
  return up.audioId;
}
async function transcribed(h: Host, sessionId: string) {
  authorizeSpeech(h, sessionId);
  const a = h.speech('speech.asr.start', {operationId: 'asr', audioId: upload(h, sessionId), expectedRevision: 1}) as {jobId: string};
  await h.wait(a.jobId);
  const t = h.speech('speech.task.get', {jobId: a.jobId}) as Transcript;
  expect(t.status).toBe('transcribed');
  return {operationId: 'confirm', jobId: a.jobId, expectedVersion: t.version, expectedRevision: 1, text: t.transcript!.originalText};
}

test('speech confirmation replay is one job; another operationId cannot score the same candidate twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-confirm-boundary-'));
  let speechCalls = 0, modelCalls = 0;
  const h = await createLocalHost({dataDir: root, assetsRoot: process.cwd(), resolveCredential: async () => secret,
    liveFetch: async (i, n) => {modelCalls++; return modelSuccess(i, n);}, speechFetch: async () => {speechCalls++; return asrResponse();}});
  try {
    const sessionId = await question(h), confirmation = await transcribed(h, sessionId);
    const a = h.speech('speech.confirm', confirmation) as {jobId: string};
    expect(h.speech('speech.confirm', confirmation)).toMatchObject(a);
    expect(() => h.speech('speech.confirm', {...confirmation, operationId: 'other-confirm'})).toThrow('VERSION_CONFLICT');
    await h.wait(a.jobId);
    expect(h.job(a.jobId).status).toBe('completed');
    expect(h.speech('speech.confirm', confirmation)).toMatchObject(a);
    expect(h.session(sessionId)).toMatchObject({revision: 2, answeredCount: 1});
    expect(speechCalls).toBe(1); expect(modelCalls).toBe(3);
  } finally {await h.close(); await rm(root, {recursive: true, force: true});}
}, 30000);

test('a text answer wins the revision and prevents a stale transcript from becoming a second formal answer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-text-race-'));
  let modelCalls = 0;
  const h = await createLocalHost({dataDir: root, assetsRoot: process.cwd(), resolveCredential: async () => secret,
    liveFetch: async (i, n) => {modelCalls++; return modelSuccess(i, n);}, speechFetch: async () => asrResponse()});
  try {
    const sessionId = await question(h), confirmation = await transcribed(h, sessionId);
    const text = h.command('session.answer', {operationId: 'text-first', sessionId, expectedRevision: 1,
      text: '我会明确事务边界，并测试回滚后的状态一致性。'});
    await h.wait(text.jobId);
    expect(h.job(text.jobId).status).toBe('completed');
    const jobs = h.listJobs().length;
    expect(() => h.speech('speech.confirm', confirmation)).toThrow('VERSION_CONFLICT');
    expect(h.listJobs()).toHaveLength(jobs);
    expect(h.session(sessionId)).toMatchObject({revision: 2, answeredCount: 1});
    expect(h.speech('speech.task.get', {jobId: confirmation.jobId})).toMatchObject({status: 'transcribed'});
    expect(modelCalls).toBe(3);
  } finally {await h.close(); await rm(root, {recursive: true, force: true});}
}, 30000);

test('failed speech scoring requires explicit retry and original confirmation retains its original job receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-answer-retry-'));
  let modelCalls = 0, speechCalls = 0;
  const h = await createLocalHost({dataDir: root, assetsRoot: process.cwd(), resolveCredential: async () => secret,
    liveFetch: async (i, n) => {modelCalls++; return modelCalls === 3 ? stream({content: '{}'}) : modelSuccess(i, n);},
    speechFetch: async () => {speechCalls++; return asrResponse();}});
  try {
    const sessionId = await question(h), confirmation = await transcribed(h, sessionId);
    const original = h.speech('speech.confirm', confirmation) as {jobId: string};
    await h.wait(original.jobId);
    expect(h.job(original.jobId).status).toBe('failed');
    expect(h.speech('speech.confirm', confirmation)).toMatchObject(original);
    expect(modelCalls).toBe(3);
    const retry = {operationId: 'explicit-retry', jobId: original.jobId, expectedRevision: 1};
    const next = h.speech('speech.answer.retry', retry) as {jobId: string};
    expect(next.jobId).not.toBe(original.jobId);
    expect(h.speech('speech.answer.retry', retry)).toMatchObject(next);
    await h.wait(next.jobId);
    expect(h.job(next.jobId).status).toBe('completed');
    expect(h.session(sessionId)).toMatchObject({revision: 2, answeredCount: 1});
    expect(speechCalls).toBe(1); expect(modelCalls).toBe(4);
    expect(h.speech('speech.confirm', confirmation)).toMatchObject(original);
  } finally {await h.close(); await rm(root, {recursive: true, force: true});}
}, 30000);

for (const cancelAt of ['resolver', 'dispatch'] as const) test(`ASR cancellation at ${cancelAt} rejects late valid results and restart performs no speech requests`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-cancel-boundary-'));
  const entered = deferred<void>(), key = deferred<string>(), response = deferred<Response>();
  let speechCalls = 0, credentialCalls = 0, modelCalls = 0;
  const options = {dataDir: root, assetsRoot: process.cwd(),
    resolveCredential: async (binding: {grantId: string}) => {
      credentialCalls++;
      if (binding.grantId === 'asr-grant' && cancelAt === 'resolver') {entered.resolve(); return key.promise;}
      return secret;
    },
    liveFetch: async (i: Parameters<typeof fetch>[0], n?: Parameters<typeof fetch>[1]) => {modelCalls++; return modelSuccess(i, n);},
    speechFetch: async () => {speechCalls++; entered.resolve(); return response.promise;},
  };
  let h = await createLocalHost(options);
  try {
    const sessionId = await question(h); authorizeSpeech(h, sessionId);
    const a = h.speech('speech.asr.start', {operationId: 'asr', audioId: upload(h, sessionId), expectedRevision: 1}) as {jobId: string};
    await entered.promise; h.cancel(a.jobId);
    key.resolve(secret); response.resolve(asrResponse());
    // close waits for the cancelled worker too; wait alone may return on the durable cancellation status.
    await h.close();
    const before = {speechCalls, credentialCalls, modelCalls};
    h = await createLocalHost(options);
    expect(h.status().executionStarts).toBe(0);
    expect({speechCalls, credentialCalls, modelCalls}).toEqual(before);
    expect(h.job(a.jobId).status).toBe('cancelled');
    expect(h.speech('speech.task.get', {jobId: a.jobId})).toMatchObject({status: 'cancelled'});
    expect((h.speech('speech.task.get', {jobId: a.jobId}) as Transcript).transcript).toBeUndefined();
    expect(h.events(a.jobId).some(e => e.status === 'completed')).toBe(false);
    const budget = h.speech('speech.budget', {sessionId}) as {attempts: {status: string}[]};
    expect(budget.attempts.map(a => a.status)).toEqual(cancelAt === 'dispatch' ? ['unknown'] : []);
    expect(speechCalls).toBe(cancelAt === 'dispatch' ? 1 : 0);
    if (cancelAt === 'dispatch') {
      h.authorize({sessionId, grantId: 'renewed-model', expectedVersion: 1, expiresAt: Date.now() + 60000,
        credentialRef: 'synthetic-model-ref', profile: config.profile});
      expect(() => h.command('session.answer', {operationId: 'blocked-text', sessionId, expectedRevision: 1,
        text: '未知语音账目必须阻断新的付费评分。'})).toThrow('BUDGET_RECONCILIATION_REQUIRED');
      expect({speechCalls, credentialCalls, modelCalls}).toEqual(before);
    }
  } finally {key.resolve(secret); response.resolve(asrResponse()); await h.close(); await rm(root, {recursive: true, force: true});}
}, 30000);

test('missing ASR grant prevents job admission, credential lookup and HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-missing-grant-'));
  let speechCalls = 0, credentialCalls = 0;
  const h = await createLocalHost({dataDir: root, assetsRoot: process.cwd(),
    resolveCredential: async () => {credentialCalls++; return secret;}, liveFetch: modelSuccess,
    speechFetch: async () => {speechCalls++; return asrResponse();}});
  try {
    const sessionId = await question(h), audioId = upload(h, sessionId), keys = credentialCalls, jobs = h.listJobs().length;
    expect(() => h.speech('speech.asr.start', {operationId: 'asr', audioId, expectedRevision: 1})).toThrow('LOCAL_GRANT_INACTIVE');
    expect(h.listJobs()).toHaveLength(jobs); expect(credentialCalls).toBe(keys); expect(speechCalls).toBe(0);
    expect((h.speech('speech.budget', {sessionId}) as {attempts: unknown[]}).attempts).toHaveLength(0);
  } finally {await h.close(); await rm(root, {recursive: true, force: true});}
}, 30000);

test('confirmation transaction failure rolls back answer job and source link before retrying the same operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-confirm-rollback-'));
  let modelCalls = 0;
  const h = await createLocalHost({dataDir: root, assetsRoot: process.cwd(), resolveCredential: async () => secret,
    liveFetch: async (i, n) => {modelCalls++; return modelSuccess(i, n);}, speechFetch: async () => asrResponse()});
  let db: Database | undefined;
  try {
    const sessionId = await question(h), confirmation = await transcribed(h, sessionId), jobs = h.listJobs().length;
    db = new Database(join(root, 'agent', 'profiles', 'default', 'profile.sqlite'));
    db.exec("CREATE TRIGGER reject_confirmation BEFORE UPDATE ON local_speech_tasks WHEN json_extract(NEW.body,'$.status')='confirmed' BEGIN SELECT RAISE(ABORT,'synthetic confirmation write failure'); END");
    expect(() => h.speech('speech.confirm', confirmation)).toThrow('synthetic confirmation write failure');
    await new Promise(r => setTimeout(r, 10));
    expect(h.listJobs()).toHaveLength(jobs);
    expect(h.speech('speech.task.get', {jobId: confirmation.jobId})).toMatchObject({status: 'transcribed', version: confirmation.expectedVersion});
    expect(db.query('SELECT COUNT(*) AS n FROM local_speech_links').get()).toEqual({n: 0});
    expect(modelCalls).toBe(2); expect(h.session(sessionId).revision).toBe(1);
    db.exec('DROP TRIGGER reject_confirmation');
    const accepted = h.speech('speech.confirm', confirmation) as {jobId: string};
    await h.wait(accepted.jobId);
    expect(h.job(accepted.jobId).status).toBe('completed');
    expect(h.session(sessionId)).toMatchObject({revision: 2, answeredCount: 1});
    expect(modelCalls).toBe(3);
  } finally {db?.close(); await h.close(); await rm(root, {recursive: true, force: true});}
}, 30000);


test('cancelled ASR retains a physical execution slot until a transport ignoring abort really settles',async()=>{const root=await mkdtemp(join(tmpdir(),'speech-physical-slot-')),entered=deferred<void>(),response=deferred<Response>();const h=await createLocalHost({dataDir:root,assetsRoot:process.cwd(),resolveCredential:async()=>secret,liveFetch:modelSuccess,speechFetch:async()=>{entered.resolve();return response.promise;}});try{const sessionId=await question(h);authorizeSpeech(h,sessionId);const asr=h.speech('speech.asr.start',{operationId:'physical-asr',audioId:upload(h,sessionId),expectedRevision:1})as {jobId:string};await entered.promise;h.cancel(asr.jobId);await new Promise(r=>setTimeout(r,20));expect(h.job(asr.jobId).status).toBe('cancelled');expect(h.status().activeJobs).toBe(1);expect(h.status().unknownAttempts).toBe(1);response.resolve(asrResponse());await new Promise(r=>setTimeout(r,30));expect(h.status().activeJobs).toBe(0);expect(h.speech('speech.task.get',{jobId:asr.jobId})).toMatchObject({status:'cancelled'});}finally{response.resolve(asrResponse());await h.close();await rm(root,{recursive:true,force:true});}},30000);
