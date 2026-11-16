import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jobRoles } from './catalog.ts';
import { users } from './identity.ts';
import { policyVersions } from './policies.ts';
import {
  datasetGroup,
  deploymentStatus,
  evalCaseSource,
  evalDatasetStatus,
  evalLabelSource,
  experimentExecutionStatus,
  experimentStatus,
  reviewStatus,
} from './enums.ts';

export const evalDatasets = pgTable(
  'eval_dataset',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    roleId: text('role_id')
      .notNull()
      .references(() => jobRoles.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    group: datasetGroup('group').notNull(),
    status: evalDatasetStatus('status').notNull().default('draft'),
    itemCount: integer('item_count').notNull().default(0),
    contentHash: text('content_hash'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    frozenBy: text('frozen_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('eval_dataset_scope_unique').on(table.roleId, table.name, table.version),
    index('eval_dataset_group_idx').on(table.roleId, table.group),
    check('eval_dataset_item_count_non_negative', sql`${table.itemCount} >= 0`),
    check('eval_dataset_frozen_consistency', sql`(${table.status} = 'frozen') = (${table.frozenAt} is not null)`),
    check('eval_dataset_frozen_has_hash', sql`${table.status} <> 'frozen' or ${table.contentHash} is not null`),
  ],
);

export const evalCases = pgTable(
  'eval_case',
  {
    id: text('id').primaryKey(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => evalDatasets.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => jobRoles.id, { onDelete: 'cascade' }),
    skillId: text('skill_id'),
    source: evalCaseSource('source').notNull().default('synthetic'),
    sourceGroup: text('source_group'),
    labelSource: evalLabelSource('label_source').notNull().default('unlabeled'),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    authorizationRef: text('authorization_ref'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    expected: jsonb('expected').$type<Record<string, unknown>>().notNull(),
    contentHash: text('content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('eval_case_dataset_idx').on(table.datasetId),
    index('eval_case_skill_idx').on(table.roleId, table.skillId),
    index('eval_case_source_group_idx').on(table.sourceGroup),
    check('eval_case_consented_requires_authorization', sql`${table.source} <> 'consented' or ${table.authorizationRef} is not null`),
    check('eval_case_reviewed_has_hash', sql`${table.reviewStatus} <> 'reviewed' or ${table.contentHash} is not null`),
  ],
);

export const evalExperiments = pgTable(
  'eval_experiment',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => jobRoles.id, { onDelete: 'cascade' }),
    baselinePolicyVersion: text('baseline_policy_version').notNull(),
    candidatePolicyVersion: text('candidate_policy_version').notNull(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => evalDatasets.id, { onDelete: 'restrict' }),
    datasetVersion: text('dataset_version').notNull(),
    datasetDigest: text('dataset_digest').notNull(),
    configDigest: text('config_digest').notNull(),
    executionBudget: jsonb('execution_budget').$type<Record<string, unknown>>().notNull().default({}),
    authorizedBy: text('authorized_by').references(() => users.id, { onDelete: 'set null' }),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    status: experimentStatus('status').notNull().default('created'),
    deploymentStatus: deploymentStatus('deployment_status').notNull().default('not_published'),
    thresholds: jsonb('thresholds').$type<Record<string, number>>().notNull().default({}),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    resultSummary: text('result_summary'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    rollbackReason: text('rollback_reason'),
  },
  (table) => [
    index('eval_experiment_role_idx').on(table.roleId, table.createdAt),
    index('eval_experiment_status_idx').on(table.status),
    foreignKey({
      name: 'eval_experiment_baseline_policy_fk',
      columns: [table.baselinePolicyVersion],
      foreignColumns: [policyVersions.version],
    }).onDelete('restrict'),
    foreignKey({
      name: 'eval_experiment_candidate_policy_fk',
      columns: [table.candidatePolicyVersion],
      foreignColumns: [policyVersions.version],
    }).onDelete('restrict'),
    check('eval_experiment_distinct_policies', sql`${table.baselinePolicyVersion} <> ${table.candidatePolicyVersion}`),
    check(
      'eval_experiment_running_requires_authorization',
      sql`${table.status} <> 'running' or (${table.authorizedBy} is not null and ${table.authorizedAt} is not null)`,
    ),
    check(
      'eval_experiment_published_requires_approval',
      sql`${table.deploymentStatus} <> 'published' or (${table.approvedAt} is not null and ${table.approvedBy} is not null)`,
    ),
    check(
      'eval_experiment_rollback_consistency',
      sql`${table.deploymentStatus} <> 'rolled_back' or (${table.rolledBackAt} is not null and ${table.rollbackReason} is not null)`,
    ),
  ],
);

export const experimentCaseResults = pgTable(
  'experiment_case_result',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => evalExperiments.id, { onDelete: 'cascade' }),
    caseId: text('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    baselineScore: numeric('baseline_score', { precision: 5, scale: 4 }),
    candidateScore: numeric('candidate_score', { precision: 5, scale: 4 }),
    hit: boolean('hit'),
    excluded: boolean('excluded').notNull().default(false),
    exclusionReason: text('exclusion_reason'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('experiment_case_result_unique').on(table.experimentId, table.caseId),
    check(
      'experiment_case_result_score_range',
      sql`(${table.baselineScore} is null or ${table.baselineScore} between 0 and 1) and (${table.candidateScore} is null or ${table.candidateScore} between 0 and 1)`,
    ),
    check(
      'experiment_case_result_exclusion_reason',
      sql`(${table.excluded} = false and ${table.exclusionReason} is null) or (${table.excluded} = true and char_length(btrim(${table.exclusionReason})) > 0)`,
    ),
  ],
);

export const experimentExecutions = pgTable(
  'experiment_execution',
  {
    id: text('id').primaryKey(),
    experimentId: text('experiment_id')
      .notNull()
      .references(() => evalExperiments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: experimentExecutionStatus('status').notNull().default('queued'),
    budget: jsonb('budget').$type<Record<string, unknown>>().notNull().default({}),
    authorizedBy: text('authorized_by').references(() => users.id, { onDelete: 'set null' }),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    usage: jsonb('usage').$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('experiment_execution_experiment_idx').on(table.experimentId, table.createdAt),
    index('experiment_execution_status_idx').on(table.status),
    check(
      'experiment_execution_terminal_consistency',
      sql`(${table.status} in ('completed', 'failed', 'cancelled')) = (${table.endedAt} is not null)`,
    ),
  ],
);

export const policyChampions = pgTable(
  'policy_champion',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => jobRoles.id, { onDelete: 'cascade' }),
    skillId: text('skill_id'),
    policyVersion: text('policy_version')
      .notNull()
      .references(() => policyVersions.version, { onDelete: 'restrict' }),
    previousPolicyVersion: text('previous_policy_version'),
    activatedByExperimentId: text('activated_by_experiment_id'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
    rollbackReason: text('rollback_reason'),
  },
  (table) => [
    uniqueIndex('policy_champion_scope_unique')
      .on(table.roleId, sql`coalesce(${table.skillId}, '')`)
      .where(sql`${table.rolledBackAt} is null`),
    index('policy_champion_role_idx').on(table.roleId),
    foreignKey({
      name: 'policy_champion_previous_policy_fk',
      columns: [table.previousPolicyVersion],
      foreignColumns: [policyVersions.version],
    }).onDelete('set null'),
    foreignKey({
      name: 'policy_champion_experiment_fk',
      columns: [table.activatedByExperimentId],
      foreignColumns: [evalExperiments.id],
    }).onDelete('set null'),
    check(
      'policy_champion_rollback_consistency',
      sql`${table.rolledBackAt} is null or (${table.rollbackReason} is not null and ${table.previousPolicyVersion} is not null)`,
    ),
  ],
);