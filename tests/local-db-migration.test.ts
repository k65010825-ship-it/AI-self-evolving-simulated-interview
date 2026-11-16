import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';

const migrationsDirectory = new URL('../packages/local-db/drizzle/', import.meta.url);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const db = new Database(':memory:');
db.exec('PRAGMA foreign_keys=ON');

for (const file of migrationFiles) {
  const statements = readFileSync(new URL(file, migrationsDirectory), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) db.exec(statement);
}

db.exec(`
  insert into user_gamification (user_id) values ('u1');
  insert into interview_session (id, user_id, role_id, goal, duration_minutes, status, policy_version, state)
    values ('i1', 'u1', 'java-backend', '练习事务', 20, 'planning', 'baseline-v0', '{}');
  insert into interview_turn (id, interview_id, seq, question_text, question_type, skill_id, difficulty)
    values ('t1', 'i1', 0, '下单事务与缓存一致性怎么设计？', 'scenario', 'spring-transactions', 3);
  update interview_turn set status = 'answered', answer = '先写库再删缓存', answer_submitted_at = 1000, idempotency_key = 'k1' where id = 't1';
  insert into agent_run (id, interview_id, user_id, kind, status, policy_version, input_snapshot)
    values ('r1', 'i1', 'u1', 'initial_plan', 'queued', 'baseline-v0', '{}');
  insert into run_attempt (id, run_id, attempt_no) values ('a1', 'r1', 1);
  insert into run_event (run_id, attempt_id, seq, type, payload) values ('r1', 'a1', 1, 'run.accepted', '{}');
  insert into evaluation (id, interview_id, turn_id, user_id, role_id, skill_id, rubric_version, evaluator_version)
    values ('ev1', 'i1', 't1', 'u1', 'java-backend', 'spring-transactions', 'seed-0.1', 'v1');
  insert into evaluation_dimension (evaluation_id, dimension, status, score)
    values ('ev1', 'correctness', 'zero', 0);
  insert into xp_event (id, user_id, reason, xp_delta, coin_delta, balance_xp, balance_coins, source_type, source_id, dedupe_key)
    values ('x1', 'u1', 'interview_completed', 10, 0, 10, 0, 'interview_session', 'i1', 'u1:interview:i1');
`);

function rejected(sql: string): void {
  expect(() => db.exec(sql)).toThrow();
}

describe('local sqlite migration on the Bun SQLite engine', () => {
  test('creates every local table and none of the server tables', () => {
    const rows = db.query(`select name from sqlite_master where type = 'table'`).all() as { name: string }[];
    const names = rows.map((row) => row.name);
    expect(names).toContain('interview_session');
    expect(names).toContain('skill_profile');
    expect(names).toContain('skill_observation');
    expect(names).toContain('budget_ledger');
    expect(names).toContain('user_gamification');
    expect(names).not.toContain('job_role');
    expect(names).not.toContain('eval_experiment');
  });

  test('keeps the interview state machine honest', () => {
    rejected(`insert into interview_session (id, user_id, role_id, goal, duration_minutes, status, policy_version, state)
      values ('i2', 'u1', 'java-backend', '练习', 10, 'planning', 'baseline-v0', '{}')`);
    rejected(`update interview_session set status = 'completed' where id = 'i1'`);
  });

  test('enforces answer idempotency and sequencing', () => {
    rejected(`insert into interview_turn (id, interview_id, seq, question_text, question_type, skill_id, difficulty, status)
      values ('t2', 'i1', 1, 'volatile 的可见性？', 'technical', 'spring-transactions', 2, 'answered')`);
    rejected(`insert into interview_turn (id, interview_id, seq, question_text, question_type, skill_id, difficulty, idempotency_key)
      values ('t3', 'i1', 2, 'volatile 的可见性？', 'technical', 'spring-transactions', 2, 'k1')`);
  });

  test('bounds run attempts and event sequence numbers', () => {
    rejected(`insert into run_attempt (id, run_id, attempt_no) values ('a3', 'r1', 3)`);
    rejected(`insert into run_event (run_id, attempt_id, seq, type, payload)
      values ('r1', 'a1', 1, 'run.stage', '{}')`);
  });

  test('bounds diagnostic budget operation labels without claiming runtime accounting', () => {
    db.exec(`insert into budget_ledger (id, run_id, operation) values ('b1', 'r1', 'reserve')`);
    rejected(`insert into budget_ledger (id, run_id, operation) values ('b2', 'r1', 'refund')`);
  });

  test('records gamification deltas idempotently', () => {
    rejected(`insert into xp_event (id, user_id, reason, xp_delta, coin_delta, balance_xp, balance_coins, source_type, source_id, dedupe_key)
      values ('x2', 'u1', 'hint_used', 0, 1, 0, 10, 'interview_turn', 't1', 'u1:hint:t1')`);
    db.exec(`insert into xp_event (id, user_id, reason, xp_delta, coin_delta, balance_xp, balance_coins, source_type, source_id, dedupe_key)
      values ('x3', 'u1', 'hint_used', 0, -1, 10, 9, 'interview_turn', 't1', 'u1:hint:t1')`);
    rejected(`insert into xp_event (id, user_id, reason, xp_delta, coin_delta, balance_xp, balance_coins, source_type, source_id, dedupe_key)
      values ('x4', 'u1', 'hint_used', 0, -1, 10, 9, 'interview_turn', 't1', 'u1:hint:t1')`);
  });

  test('distinguishes zero from missing evidence in scoring', () => {
    db.exec(`insert into evaluation_dimension (evaluation_id, dimension, status)
      values ('ev1', 'depth', 'missing_evidence')`);
    rejected(`insert into evaluation_dimension (evaluation_id, dimension, status, score)
      values ('ev1', 'logic', 'missing_evidence', 0)`);
    rejected(`insert into evaluation_dimension (evaluation_id, dimension, status)
      values ('ev1', 'role_fit', 'scored')`);
  });
});

describe('local projection integrity regressions', () => {
  test('rejects orphan answers and dimensions even with remote identifiers left as text', () => {
    rejected(`insert into interview_turn(id,interview_id,seq,question_text,question_type,skill_id,difficulty)
      values('orphan','missing',0,'test','technical','s',1)`);
    rejected(`insert into evaluation_dimension(evaluation_id,dimension,status,score)
      values('missing','correctness','scored',0.5)`);
  });
  test('zero explicitly requires a numeric score', () => {
    rejected(`insert into evaluation_dimension(evaluation_id,dimension,status,score)
      values('ev1','communication','zero',NULL)`);
  });
  test('hint use cannot mint XP', () => {
    rejected(`insert into xp_event(id,user_id,reason,xp_delta,coin_delta,balance_xp,balance_coins,source_type,source_id,dedupe_key)
      values('xp-bug','u1','hint_used',100,-1,100,0,'turn','t1','xp-bug')`);
  });
  test('eligible pair error is bounded and matches the scores', () => {
    db.exec(`insert into prediction_snapshot(id,user_id,role_id,skill_id,expected_learning_exposure,valid_until,rubric_version,predicted_target_score,predictor_version)
      values('pred-regression','u1','java-backend','s','verified practice',9999999999999,'v1',0.2,'p1')`);
    const pair = (id: string, mae: number) => `insert into performance_pair(id,prediction_id,user_id,role_id,skill_id,retest_interview_id,predicted_score,reference_score,mae,eligibility,rubric_version,learning_exposure_matched)
      values('${id}','pred-regression','u1','java-backend','s','i1',0.2,0.2,${mae},'eligible','v1',1)`;
    rejected(pair('impossible', 7));
    rejected(pair('wrong-arithmetic', 0.3));
    db.exec(pair('valid-arithmetic', 0));
  });
  test('local task projection accepts interrupted without claiming completion', () => {
    db.exec(`insert into agent_run(id,interview_id,user_id,kind,status,policy_version,input_snapshot)
      values('interrupted-regression','i1','u1','answer_processing','interrupted','p','{}')`);
    expect(db.query("select status from agent_run where id='interrupted-regression'").get()).toEqual({status:'interrupted'});
  });
  test('memory-only audio does not invent a persisted file', () => {
    db.exec(`insert into audio_asset(id,user_id,interview_id,mime_type,byte_size)
      values('memory-audio','u1','i1','audio/wav',100)`);
    expect(db.query("select storage_key from audio_asset where id='memory-audio'").get()).toEqual({storage_key:null});
  });
});
