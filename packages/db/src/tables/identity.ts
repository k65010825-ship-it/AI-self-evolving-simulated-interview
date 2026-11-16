import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { userRole, userStatus } from './enums.ts';

export const users = pgTable(
  'app_user',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: userRole('role').notNull().default('student'),
    status: userStatus('status').notNull().default('active'),
    passwordHash: text('password_hash').notNull(),
    passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true }).notNull().defaultNow(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(1),
    coins: integer('coins').notNull().default(0),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('app_user_email_unique').on(sql`lower(${table.email})`),
    index('app_user_role_idx').on(table.role),
    check('app_user_email_length', sql`char_length(${table.email}) between 3 and 320`),
    check('app_user_display_name_length', sql`char_length(${table.displayName}) between 1 and 80`),
    check('app_user_xp_non_negative', sql`${table.xp} >= 0`),
    check('app_user_level_positive', sql`${table.level} >= 1`),
    check('app_user_coins_non_negative', sql`${table.coins} >= 0`),
  ],
);

export const authSessions = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: text('family_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    userAgent: text('user_agent'),
    rotatedFromId: text('rotated_from_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_session_token_hash_unique').on(table.tokenHash),
    index('auth_session_user_idx').on(table.userId),
    index('auth_session_family_idx').on(table.familyId),
    check('auth_session_expiry_after_issue', sql`${table.expiresAt} > ${table.issuedAt}`),
    check(
      'auth_session_revoked_after_issue',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.issuedAt}`,
    ),
  ],
);
