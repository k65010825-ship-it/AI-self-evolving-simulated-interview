import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrationsDirectory = new URL('../packages/db/drizzle/', import.meta.url);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  for (const file of migrationFiles) {
    const statements = readFileSync(new URL(file, migrationsDirectory), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await db.exec(statement);
  }
  await db.exec(`
    insert into "role" (id, name, summary, knowledge_version, rubric_version)
      values ('java-backend', 'Java 后端', 'seed', 'seed-0.1', 'seed-0.1');
    insert into role_skill (role_id, skill_id, name) values ('java-backend', 'spring-transactions', 'Spring 事务');
    insert into policy_version (version, role_id, status, parameters)
      values ('baseline-v0', null, 'baseline', '{"uncertaintyPriorityBoost":0.2,"maxFollowupDepth":2,"coverageReserveRatio":0.3}'::jsonb);
    insert into app_user (id, email, display_name, password_hash) values ('u1', 'student@example.com', '学生', 'hash');
    insert into interview_session (id, user_id, role_id, goal, duration_minutes, status, policy_version, state)
      values ('i1', 'u1', 'java-backend', '练习事务', 20, 'planning', 'baseline-v0', '{}'::jsonb);
    insert into interview_turn (id, interview_id, seq, question_text, question_type, skill_id, difficulty)
      values ('t1', 'i1', 0, '下单事务与缓存一致性怎么设计？', 'scenario', 'spring-transactions', 3);
    update interview_turn set status = 'answered', answer = '先写库再删缓存', answer_submitted_at = now(), idempotency_key = 'k1' where id = 't1';
    insert into agent_run (id, interview_id, user_id, kind, status, policy_version, input_snapshot)
      values ('r1', 'i1', 'u1', 'initial_plan', 'queued', 'baseline-v0', '{}'::jsonb);
    insert into run_attempt (id, run_id, attempt_no) values ('a1', 'r1', 1);
    insert into run_event (run_id, attempt_id, seq, type, payload) values ('r1', 'a1', 1, 'run.accepted', '{}'::jsonb);
    insert into policy_champion (id, role_id, policy_version) values ('c1', 'java-backend', 'baseline-v0');
  `);
});

afterAll(async () => {
  await db.close();
});

async function rejected(sql: string): Promise<void> {
  await expect(db.exec(sql)).rejects.toThrow();
}

describe('drizzle migration on a real PostgreSQL engine', () => {
  test('applies every statement and creates the documented tables', async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.length).toBe(44);
    expect(tables.rows.map((row) => row.table_name)).toContain('interview_session');
    expect(tables.rows.map((row) => row.table_name)).toContain('run_event');
  });

  test('keeps the interview state machine honest', async () => {
    await rejected(`insert into interview_session (id, user_id, role_id, goal, duration_minutes, status, policy_version, state)
      values ('i2', 'u1', 'java-backend', '练习', 10, 'planning', 'baseline-v0', '{}'::jsonb)`);
    await rejected(`update interview_session set status = 'completed' where id = 'i1'`);
  });

  test('enforces answer idempotency, sequencing and evidence dedupe', async () => {
    await rejected(`insert into interview_turn (id, interview_id, seq, question_text, question_type, skill_id, difficulty, status)
      values ('t2', 'i1', 1, 'volatile 的可见性？', 'technical', 'spring-transactions', 2, 'answered')`);
    await rejected(`insert into interview_turn (id, interview_id, seq, question_text, question_type, skill_id, difficulty, idempotency_key)
      values ('t3', 'i1', 2, 'volatile 的可见性？', 'technical', 'spring-transactions', 2, 'k1')`);
    const evidence = `insert into skill_observation (id, user_id, role_id, skill_id, interview_id, turn_id, source, dedupe_key)
      values ('o1', 'u1', 'java-backend', 'spring-transactions', 'i1', 't1', 'interview', 'u1:spring-transactions:q1')`;
    await db.exec(evidence);
    await rejected(evidence.replace(`'o1'`, `'o2'`));
  });

  test('bounds run attempts and event sequence numbers', async () => {
    await rejected(`insert into run_attempt (id, run_id, attempt_no) values ('a3', 'r1', 3)`);
    await rejected(`insert into run_event (run_id, attempt_id, seq, type, payload)
      values ('r1', 'a1', 1, 'run.stage', '{}'::jsonb)`);
  });

  test('allows one active champion per scope and keeps rollback history', async () => {
    await rejected(`insert into policy_champion (id, role_id, policy_version) values ('c2', 'java-backend', 'baseline-v0')`);
    await db.exec(`update policy_champion set rolled_back_at = now(), rollback_reason = '指标回落', previous_policy_version = 'baseline-v0' where id = 'c1'`);
    await db.exec(`insert into policy_champion (id, role_id, policy_version) values ('c3', 'java-backend', 'baseline-v0')`);
  });

  test('constrains whitelisted policy parameters and score ranges', async () => {
    await rejected(`insert into policy_version (version, status, parameters)
      values ('bad-depth', 'candidate', '{"uncertaintyPriorityBoost":0.2,"maxFollowupDepth":9,"coverageReserveRatio":0.3}'::jsonb)`);
    await rejected(`insert into interview_report (id, interview_id, user_id, role_id, policy_version, rubric_version, overall_score)
      values ('rep1', 'i1', 'u1', 'java-backend', 'baseline-v0', 'seed-0.1', 1.5)`);
  });

  test('records gamification deltas idempotently', async () => {
    await rejected(`insert into xp_event (id, user_id, reason, xp_delta, coin_delta, balance_xp, balance_coins, level_after, source_type, source_id, dedupe_key)
      values ('x1', 'u1', 'hint_used', 0, 1, 0, 10, 1, 'interview_turn', 't1', 'u1:hint:t1')`);
    const spend = `insert into xp_event (id, user_id, reason, xp_delta, coin_delta, balance_xp, balance_coins, level_after, source_type, source_id, dedupe_key)
      values ('x2', 'u1', 'hint_used', 0, -1, 0, 9, 1, 'interview_turn', 't1', 'u1:hint:t1')`;
    await db.exec(spend);
    await rejected(spend.replace(`'x2'`, `'x3'`));
  });

  test('treats email uniqueness case-insensitively', async () => {
    await rejected(`insert into app_user (id, email, display_name, password_hash)
      values ('u2', 'STUDENT@example.com', '学生2', 'hash')`);
  });
});
