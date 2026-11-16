import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../packages/db/src/schema.ts';
import { RunEventSchema } from '../packages/contracts/src/events.ts';
import { KnowledgeItemSchema } from '../packages/contracts/src/tools.ts';

function isPgTable(value: unknown): boolean {
  return is(value, PgTable);
}

const tables = Object.values(schema).filter(isPgTable) as PgTable[];

const tableNames = new Set(tables.map((table) => getTableConfig(table).name));

const expectedTables = [
  'agent_run',
  'alert',
  'app_user',
  'audio_analysis',
  'audio_asset',
  'audit_log',
  'auth_session',
  'eval_case',
  'eval_dataset',
  'eval_experiment',
  'evaluation',
  'evaluation_dimension',
  'experiment_case_result',
  'feedback_entry',
  'idempotency_record',
  'interview_report',
  'interview_session',
  'interview_turn',
  'knowledge_item',
  'knowledge_item_source',
  'knowledge_review',
  'knowledge_source',
  'learning_progress',
  'learning_resource',
  'learning_resource_skill',
  'metric_snapshot',
  'performance_pair',
  'plan_decision',
  'policy_champion',
  'policy_version',
  'prediction_snapshot',
  'recommendation',
  'reflection',
  'report_dimension',
  'role',
  'role_skill',
  'rubric',
  'rubric_criterion',
  'run_attempt',
  'run_event',
  'skill_observation',
  'skill_profile',
  'transcript',
  'xp_event',
];

const migrationsDirectory = new URL('../packages/db/drizzle/', import.meta.url);
const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql'));
const migrationSql = migrationFiles.map((file) => readFileSync(new URL(file, migrationsDirectory), 'utf8')).join('\n');

function constraintNames(table: PgTable): string[] {
  const config = getTableConfig(table);
  return [
    ...config.indexes.map((entry) => entry.config.name),
    ...config.checks.map((entry) => entry.name),
    ...config.uniqueConstraints.map((entry) => entry.name),
  ].filter((name): name is string => typeof name === 'string');
}

describe('postgres schema covers the documented data model', () => {
  test('defines exactly the documented tables', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
    expect([...tableNames].sort()).toEqual(expectedTables);
  });

  test('keeps shared-contract enums as the single source of values', () => {
    const values = (input: readonly string[]) => [...input];
    expect(values(schema.runEventType.enumValues)).toEqual(values(RunEventSchema.shape.type.options));
    expect(values(schema.questionType.enumValues)).toEqual(values(KnowledgeItemSchema.shape.questionType.options));
    expect(values(schema.reviewStatus.enumValues)).toEqual(values(KnowledgeItemSchema.shape.reviewStatus.options));
    expect(values(schema.interviewStatus.enumValues)).toEqual([
      'planning',
      'awaiting_answer',
      'processing_answer',
      'completed',
      'cancelled',
      'failed',
    ]);
    expect(schema.runStatus.enumValues).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled']);
  });

  test('keeps the lightweight gamification model on the user row', () => {
    const columns = getTableConfig(schema.users).columns.map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['xp', 'level', 'coins']));
    expect(schema.users.role.enumValues).toEqual(['student', 'admin']);
  });

  test('enforces answer idempotency and versioned interview state', () => {
    const turnConstraints = constraintNames(schema.interviewTurns);
    expect(turnConstraints).toContain('interview_turn_idempotency_unique');
    expect(turnConstraints).toContain('interview_turn_seq_unique');
    const interviewColumns = getTableConfig(schema.interviews).columns.map((column) => column.name);
    expect(interviewColumns).toEqual(
      expect.arrayContaining(['session_version', 'policy_version', 'current_question_id', 'duration_minutes']),
    );
  });

  test('separates independent evidence, self-reported learning and strategy champions', () => {
    expect(constraintNames(schema.skillObservations)).toContain('skill_observation_dedupe_unique');
    expect(constraintNames(schema.learningProgress)).toContain('learning_progress_evidence_level_match');
    expect(constraintNames(schema.policyChampions)).toContain('policy_champion_scope_unique');
    expect(constraintNames(schema.experimentCaseResults)).toContain('experiment_case_result_unique');
  });
});

describe('generated migration', () => {
  test('creates every table and enum in the migration SQL', () => {
    for (const name of expectedTables) {
      expect(migrationSql).toContain(`CREATE TABLE "${name}"`);
    }
    expect(migrationSql).toContain('CREATE TYPE "public"."interview_status"');
    expect(migrationSql).toContain('CREATE TYPE "public"."xp_reason"');
    expect(migrationSql).not.toContain('DROP TABLE');
  });

  test('persists SSE sequence numbers per run', () => {
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "run_event_seq_unique"');
    expect(migrationSql).toContain('"id" bigserial PRIMARY KEY NOT NULL');
  });
});
