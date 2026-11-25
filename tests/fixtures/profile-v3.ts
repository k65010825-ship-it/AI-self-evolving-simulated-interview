import { Database } from 'bun:sqlite';

/** Synthetic profile v3 fixture. TEST ONLY; mirrors the 17 local_* tables from feature/agent. */
export const V3_OWNER = 'host-owner';
export const V3_FENCE = 7;
export const V3_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
export const V3_NOW = 1_760_000_000_000;
export const V3_SESSION_ID = 'session-1';

export const V3_DDL = `
CREATE TABLE local_control(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,fence INTEGER NOT NULL,lease_until INTEGER NOT NULL,profile_id TEXT NOT NULL,last_time INTEGER NOT NULL);
CREATE TABLE local_sessions(session_id TEXT PRIMARY KEY,role_id TEXT NOT NULL,storage_version INTEGER NOT NULL,workflow TEXT,created_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL);
CREATE TABLE local_memory(role_id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE local_jobs(job_id TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,role_id TEXT NOT NULL,digest TEXT NOT NULL,request TEXT NOT NULL,ticket TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT,receipt TEXT,error_code TEXT,created_at INTEGER NOT NULL);
CREATE TABLE local_events(job_id TEXT NOT NULL,seq INTEGER NOT NULL,event TEXT NOT NULL,PRIMARY KEY(job_id,seq));
CREATE TABLE local_budget(attempt_id TEXT PRIMARY KEY,job_id TEXT NOT NULL,status TEXT NOT NULL,kind TEXT NOT NULL,reserved_cost INTEGER NOT NULL,used_cost INTEGER,usage TEXT);
CREATE TABLE local_session_budgets(session_id TEXT PRIMARY KEY,body TEXT NOT NULL,grant_version INTEGER NOT NULL DEFAULT 0,current_grant TEXT);
CREATE TABLE local_live_grants(grant_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE local_model_checkpoints(job_id TEXT NOT NULL,run_id TEXT NOT NULL,attempt_id TEXT NOT NULL,session_id TEXT NOT NULL,grant_id TEXT NOT NULL,snapshot TEXT NOT NULL,profile TEXT NOT NULL,PRIMARY KEY(run_id,attempt_id));
CREATE TABLE local_live_reconciliations(run_id TEXT NOT NULL,attempt_id TEXT NOT NULL,call_id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(run_id,attempt_id,call_id));
CREATE TABLE local_resource_budgets(session_id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE local_speech_grants(grant_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,capability TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,owner TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE local_speech_grant_versions(session_id TEXT NOT NULL,capability TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(session_id,capability));
CREATE TABLE local_speech_attempts(call_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE local_speech_reconciliations(call_id TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL);
CREATE TABLE local_speech_tasks(job_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE local_speech_links(job_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,confirmation_id TEXT NOT NULL,digest TEXT NOT NULL);
PRAGMA user_version=3;
`;

export const V3_WORKFLOW = {
  schemaVersion: 1,
  sessionId: V3_SESSION_ID,
  identity: { userId: V3_PROFILE_ID, roleId: 'java-backend' },
  catalogPin: { packId: 'seed-0.2', version: 'seed-0.2', digest: 'a'.repeat(64) },
  hintAssistance: [{
    questionId: 'question-1',
    assistance: { kind: 'hint-assisted', issueId: 'b'.repeat(64), hintVersion: 'coaching-v1', receiptIds: ['hint-op-1'] },
  }],
};

export const V3_MEMORY = { schemaVersion: 1, roleId: 'java-backend', weakSkills: ['spring-transactions'] };

export function createV3ProfileDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(V3_DDL);
  db.query('INSERT INTO local_control VALUES (1, ?, ?, ?, ?, ?)')
    .run(V3_OWNER, V3_FENCE, V3_NOW + 60_000, V3_PROFILE_ID, V3_NOW - 1_000);
  db.query('INSERT INTO local_sessions VALUES (?, ?, ?, ?, ?, ?)')
    .run(V3_SESSION_ID, 'java-backend', 9, JSON.stringify(V3_WORKFLOW), V3_NOW - 10_000, V3_NOW + 600_000);
  db.query('INSERT INTO local_memory VALUES (?, ?)').run('java-backend', JSON.stringify(V3_MEMORY));
  db.query('INSERT INTO local_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'job-1',
    'job-operation-1',
    V3_SESSION_ID,
    'java-backend',
    'c'.repeat(64),
    JSON.stringify({ kind: 'answer' }),
    'ticket-1',
    'completed',
    JSON.stringify({ state: 'committed' }),
    JSON.stringify({ accepted: true }),
    null,
    V3_NOW - 5_000,
  );
  db.query('INSERT INTO local_events VALUES (?, ?, ?)').run('job-1', 1, JSON.stringify({ type: 'run.completed' }));
  db.query('INSERT INTO local_budget VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('attempt-1', 'job-1', 'unknown', 'llm', 1_200, null, JSON.stringify({ reason: 'provider_timeout' }));
  db.query('INSERT INTO local_session_budgets VALUES (?, ?, ?, ?)')
    .run(V3_SESSION_ID, JSON.stringify({ maxCalls: 6 }), 2, 'grant-1');
  db.query('INSERT INTO local_live_grants VALUES (?, ?, ?, ?, ?)')
    .run('grant-1', V3_SESSION_ID, 2, JSON.stringify({ credentialRef: 'ref-1' }), 0);
  db.query('INSERT INTO local_model_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('job-1', 'run-1', 'attempt-1', V3_SESSION_ID, 'grant-1', JSON.stringify({ messages: [] }), '{}');
  db.query('INSERT INTO local_live_reconciliations VALUES (?, ?, ?, ?, ?)')
    .run('run-1', 'attempt-1', 'call-1', 'd'.repeat(64), JSON.stringify({ usage: 10 }));
  db.query('INSERT INTO local_resource_budgets VALUES (?, ?)')
    .run(V3_SESSION_ID, JSON.stringify({ asr: { maxCalls: 1 } }));
  db.query('INSERT INTO local_speech_grants VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('speech-grant-1', V3_SESSION_ID, 'asr', 1, JSON.stringify({ credentialRef: 'speech-ref' }), V3_OWNER, 0);
  db.query('INSERT INTO local_speech_grant_versions VALUES (?, ?, ?)').run(V3_SESSION_ID, 'asr', 1);
  db.query('INSERT INTO local_speech_attempts VALUES (?, ?, ?)')
    .run('speech-call-1', V3_SESSION_ID, JSON.stringify({ status: 'unknown' }));
  db.query('INSERT INTO local_speech_reconciliations VALUES (?, ?, ?)')
    .run('speech-call-1', 'e'.repeat(64), JSON.stringify({ usage: 3 }));
  db.query('INSERT INTO local_speech_tasks VALUES (?, ?, ?)')
    .run('speech-task-1', V3_SESSION_ID, JSON.stringify({ status: 'completed' }));
  db.query('INSERT INTO local_speech_links VALUES (?, ?, ?, ?)')
    .run('speech-task-1', 'speech-task-1', 'confirmation-1', 'f'.repeat(64));
  return db;
}
