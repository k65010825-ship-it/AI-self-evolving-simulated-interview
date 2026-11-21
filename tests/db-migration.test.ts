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
    insert into "job_role" (id, name, summary, knowledge_version, rubric_version)
      values ('java-backend', 'Java 后端', 'seed', 'seed-0.1', 'seed-0.1');
    insert into role_skill (role_id, skill_id, name) values ('java-backend', 'spring-transactions', 'Spring 事务');
    insert into rubric (id, role_id, skill_id, version) values ('rub-1', 'java-backend', 'spring-transactions', 'seed-0.1');
    insert into policy_version (version, role_id, status, parameters)
      values ('baseline-v0', null, 'baseline', '{"uncertaintyPriorityBoost":0.2,"maxFollowupDepth":2,"coverageReserveRatio":0.3}'::jsonb);
    insert into policy_version (version, role_id, status, parameters)
      values ('candidate-v1', null, 'candidate', '{"uncertaintyPriorityBoost":0.3,"maxFollowupDepth":2,"coverageReserveRatio":0.3}'::jsonb);
    insert into app_user (id, email, display_name, password_hash) values ('u1', 'student@example.com', '学生', 'hash');
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
  test('applies every statement and creates only the management-domain tables', async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.length).toBe(25);
    expect(tables.rows.map((row) => row.table_name)).toContain('job_role');
    expect(tables.rows.map((row) => row.table_name)).toContain('content_release');
    expect(tables.rows.map((row) => row.table_name)).not.toContain('interview_session');
    expect(tables.rows.map((row) => row.table_name)).not.toContain('skill_profile');
    expect(tables.rows.map((row) => row.table_name)).not.toContain('agent_run');
  });

  test('enforces account roles without gamification balances', async () => {
    await rejected(`insert into app_user (id, email, display_name, password_hash, account_role)
      values ('u2', 'other@example.com', '学生2', 'hash', 'interviewer')`);
    await rejected(`insert into app_user (id, email, display_name, password_hash)
      values ('u3', 'STUDENT@example.com', '学生3', 'hash')`);
  });

  test('requires reviewed knowledge to carry a content hash', async () => {
    await db.exec(`insert into knowledge_item (id, role_id, skill_id, question_type, difficulty, question, key_points, rubric_id, version)
      values ('k1', 'java-backend', 'spring-transactions', 'technical', 3, '什么是一致性？', '["要点"]'::jsonb, 'rub-1', 'seed-0.1')`);
    await rejected(`update knowledge_item set review_status = 'reviewed' where id = 'k1'`);
  });

  test('binds knowledge reviews to a target version and content hash', async () => {
    await rejected(`insert into knowledge_review (id, target_type, target_id, version, content_hash, decision, from_status, to_status, reviewer_id)
      values ('kr1', 'knowledge_item', 'k1', 'seed-0.1', '', 'approve', 'draft', 'reviewed', 'u1')`);
    await db.exec(`insert into knowledge_review (id, target_type, target_id, version, content_hash, decision, from_status, to_status, reviewer_id)
      values ('kr2', 'knowledge_item', 'k1', 'seed-0.1', 'sha256:abc', 'reject', 'draft', 'draft', 'u1')`);
  });

  test('allows one active champion per scope and keeps rollback history', async () => {
    await rejected(`insert into policy_champion (id, role_id, policy_version) values ('c2', 'java-backend', 'baseline-v0')`);
    await db.exec(`update policy_champion set rolled_back_at = now(), rollback_reason = '指标回落', previous_policy_version = 'baseline-v0' where id = 'c1'`);
    await db.exec(`insert into policy_champion (id, role_id, policy_version) values ('c3', 'java-backend', 'baseline-v0')`);
  });

  test('constrains whitelisted policy parameters', async () => {
    await rejected(`insert into policy_version (version, status, parameters)
      values ('bad-depth', 'candidate', '{"uncertaintyPriorityBoost":0.2,"maxFollowupDepth":9,"coverageReserveRatio":0.3}'::jsonb)`);
  });

  test('keeps experiments unpublished without approval and requires authorization to run', async () => {
    await db.exec(`insert into eval_dataset (id, name, role_id, version, "group")
      values ('d1', 'internal', 'java-backend', 'v1', 'internal_validation')`);
    await db.exec(`insert into eval_experiment (id, role_id, baseline_policy_version, candidate_policy_version, dataset_id, dataset_version, dataset_digest, config_digest)
      values ('e1', 'java-backend', 'baseline-v0', 'candidate-v1', 'd1', 'v1', 'sha256:data', 'sha256:cfg')`);
    await rejected(`update eval_experiment set deployment_status = 'published' where id = 'e1'`);
    await rejected(`update eval_experiment set status = 'running' where id = 'e1'`);
  });

  test('records admin experiment executions with a budget loop', async () => {
    await db.exec(`insert into experiment_execution (id, experiment_id, kind, status, budget)
      values ('x1', 'e1', 'evaluate', 'queued', '{"maxLlmCalls":10}'::jsonb)`);
    await rejected(`insert into experiment_execution (id, experiment_id, kind, status)
      values ('x2', 'e1', 'evaluate', 'completed')`);
  });
});