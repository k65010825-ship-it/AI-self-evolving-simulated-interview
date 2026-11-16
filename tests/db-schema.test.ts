import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { SQLiteTable, getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import * as serverSchema from '../packages/db/src/schema.ts';
import * as localSchema from '../packages/local-db/src/schema.ts';
import { KnowledgeItemSchema } from '../packages/contracts/src/tools.ts';

function isPgTable(value: unknown): boolean {
  return is(value, PgTable);
}

function isSqliteTable(value: unknown): boolean {
  return is(value, SQLiteTable);
}

const serverTables = Object.values(serverSchema).filter(isPgTable) as PgTable[];
const localTables = Object.values(localSchema).filter(isSqliteTable) as SQLiteTable[];

const serverTableNames = new Set(serverTables.map((table) => getTableConfig(table).name));
const localTableNames = new Set(localTables.map((table) => getSqliteTableConfig(table).name));

const expectedServerTables = [
  'alert',
  'app_user',
  'audit_log',
  'auth_session',
  'content_release',
  'eval_case',
  'eval_dataset',
  'eval_experiment',
  'experiment_case_result',
  'experiment_execution',
  'feedback_entry',
  'job_role',
  'knowledge_item',
  'knowledge_item_source',
  'knowledge_review',
  'knowledge_source',
  'learning_resource',
  'learning_resource_skill',
  'metric_measure',
  'metric_snapshot',
  'policy_champion',
  'policy_version',
  'role_skill',
  'rubric',
  'rubric_criterion',
];

const expectedLocalTables = [
  'agent_run',
  'audio_analysis',
  'audio_asset',
  'budget_ledger',
  'evaluation',
  'evaluation_dimension',
  'idempotency_record',
  'interview_report',
  'interview_session',
  'interview_turn',
  'learning_progress',
  'performance_pair',
  'plan_decision',
  'prediction_snapshot',
  'recommendation',
  'reflection',
  'report_dimension',
  'run_attempt',
  'run_event',
  'skill_observation',
  'skill_profile',
  'transcript',
  'user_gamification',
  'xp_event',
];

const pgMigrationsDirectory = new URL('../packages/db/drizzle/', import.meta.url);
const localMigrationsDirectory = new URL('../packages/local-db/drizzle/', import.meta.url);
const pgMigrationSql = readdirSync(pgMigrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(new URL(file, pgMigrationsDirectory), 'utf8'))
  .join('\n');
const localMigrationSql = readdirSync(localMigrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(new URL(file, localMigrationsDirectory), 'utf8'))
  .join('\n');

function pgConstraintNames(table: PgTable): string[] {
  const config = getTableConfig(table);
  return [
    ...config.indexes.map((entry) => entry.config.name),
    ...config.checks.map((entry) => entry.name),
    ...config.uniqueConstraints.map((entry) => entry.name),
  ].filter((name): name is string => typeof name === 'string');
}

function sqliteConstraintNames(table: SQLiteTable): string[] {
  const config = getSqliteTableConfig(table);
  return [
    ...config.indexes.map((entry) => entry.config.name),
    ...config.checks.map((entry) => entry.name),
  ].filter((name): name is string => typeof name === 'string');
}

describe('data ownership split between server and local schemas', () => {
  test('defines exactly the documented server tables', () => {
    expect([...serverTableNames].sort()).toEqual(expectedServerTables);
    expect([...localTableNames].sort()).toEqual(expectedLocalTables);
  });

  test('keeps shared-contract enums as the single source of values', () => {
    const values = (input: readonly string[]) => [...input];
    expect(values(serverSchema.questionType.enumValues)).toEqual(values(KnowledgeItemSchema.shape.questionType.options));
    expect(values(serverSchema.reviewStatus.enumValues)).toEqual(values(KnowledgeItemSchema.shape.reviewStatus.options));
    expect(values(serverSchema.accountRole.enumValues)).toEqual(['student', 'admin']);
  });

  test('renames job roles and account roles so they cannot share a key', () => {
    expect(serverTableNames).toContain('job_role');
    expect(serverTableNames).not.toContain('role');
    const userColumns = getTableConfig(serverSchema.users).columns.map((column) => column.name);
    expect(userColumns).toContain('account_role');
    expect(userColumns).not.toContain('role');
    expect(userColumns).not.toContain('xp');
    expect(userColumns).not.toContain('level');
    expect(userColumns).not.toContain('coins');
  });

  test('moves student-side data to the local ledger', () => {
    expect(localTableNames).toContain('interview_session');
    expect(localTableNames).toContain('evaluation');
    expect(localTableNames).toContain('agent_run');
    expect(localTableNames).toContain('skill_profile');
    expect(localTableNames).toContain('skill_observation');
    expect(localTableNames).toContain('user_gamification');
    expect(localTableNames).toContain('xp_event');
    expect(localTableNames).toContain('budget_ledger');
    expect(serverTableNames).not.toContain('interview_session');
    expect(serverTableNames).not.toContain('evaluation');
    expect(serverTableNames).not.toContain('agent_run');
  });

  test('keeps management-domain tables on the server', () => {
    expect(pgConstraintNames(serverSchema.policyChampions)).toContain('policy_champion_scope_unique');
    expect(pgConstraintNames(serverSchema.experimentCaseResults)).toContain('experiment_case_result_unique');
    expect(pgConstraintNames(serverSchema.contentReleases)).toContain('content_release_version_unique');
    expect(pgConstraintNames(serverSchema.metricMeasures)).toContain('metric_measure_name_unique');
  });

  test('enforces local answer idempotency and versioned interview state', () => {
    expect(sqliteConstraintNames(localSchema.interviewTurns)).toContain('interview_turn_idempotency_unique');
    expect(sqliteConstraintNames(localSchema.interviewTurns)).toContain('interview_turn_seq_unique');
    const interviewColumns = getSqliteTableConfig(localSchema.interviewSessions).columns.map((column) => column.name);
    expect(interviewColumns).toEqual(
      expect.arrayContaining(['session_version', 'policy_version', 'current_question_id', 'duration_minutes']),
    );
  });

  test('defines diagnostic budget counters without replacing the runtime ledger', () => {
    const budgetColumns = getSqliteTableConfig(localSchema.budgetLedger).columns.map((column) => column.name);
    expect(budgetColumns).toEqual(
      expect.arrayContaining(['operation', 'status', 'llm_calls', 'tool_calls', 'input_tokens', 'output_tokens']),
    );
    expect(sqliteConstraintNames(localSchema.budgetLedger)).toContain('budget_ledger_operation_values');
  });

  test('distinguishes missing evidence, abstained and zero in local scoring', () => {
    expect(sqliteConstraintNames(localSchema.evaluationDimensions)).toContain('evaluation_dimension_status_values');
    const evaluationColumns = getSqliteTableConfig(localSchema.evaluations).columns.map((column) => column.name);
    expect(evaluationColumns).toEqual(expect.arrayContaining(['scoring_status', 'answer_digest', 'answer_version']));
  });
});

describe('generated migrations', () => {
  test('server migration creates management tables and no student tables', () => {
    for (const name of expectedServerTables) {
      expect(pgMigrationSql).toContain(`CREATE TABLE "${name}"`);
    }
    expect(pgMigrationSql).toContain('CREATE TYPE "public"."account_role"');
    expect(pgMigrationSql).toContain('CREATE TYPE "public"."knowledge_review_target"');
    expect(pgMigrationSql).not.toContain('CREATE TABLE "interview_session"');
    expect(pgMigrationSql).not.toContain('CREATE TABLE "skill_profile"');
    expect(pgMigrationSql).not.toContain('CREATE TYPE "public"."run_status"');
    expect(pgMigrationSql).not.toContain('CREATE TYPE "public"."xp_reason"');
  });

  test('local migration creates every local table', () => {
    for (const name of expectedLocalTables) {
      expect(localMigrationSql).toContain(`CREATE TABLE \`${name}\``);
    }
    expect(localMigrationSql).toContain('CREATE UNIQUE INDEX `interview_turn_idempotency_unique`');
    expect(localMigrationSql).toContain('CREATE UNIQUE INDEX `xp_event_dedupe_unique`');
  });
});