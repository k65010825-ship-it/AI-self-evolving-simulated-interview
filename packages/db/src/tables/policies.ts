import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { roles } from './catalog.ts';
import { users } from './identity.ts';
import { policyStatus } from './enums.ts';

export interface PolicyParameters {
  uncertaintyPriorityBoost: number;
  maxFollowupDepth: number;
  coverageReserveRatio: number;
}

export const policyVersions = pgTable(
  'policy_version',
  {
    version: text('version').primaryKey(),
    roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }),
    skillId: text('skill_id'),
    status: policyStatus('status').notNull().default('candidate'),
    parentVersion: text('parent_version').references((): AnyPgColumn => policyVersions.version, {
      onDelete: 'set null',
    }),
    parameters: jsonb('parameters').$type<PolicyParameters>().notNull(),
    changeReason: text('change_reason'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    index('policy_version_status_idx').on(table.status),
    index('policy_version_role_idx').on(table.roleId),
    check('policy_version_max_followup_depth', sql`(${table.parameters} ->> 'maxFollowupDepth')::int between 1 and 5`),
    check(
      'policy_version_uncertainty_boost',
      sql`(${table.parameters} ->> 'uncertaintyPriorityBoost')::numeric between 0 and 1`,
    ),
    check(
      'policy_version_coverage_reserve',
      sql`(${table.parameters} ->> 'coverageReserveRatio')::numeric between 0 and 1`,
    ),
  ],
);
