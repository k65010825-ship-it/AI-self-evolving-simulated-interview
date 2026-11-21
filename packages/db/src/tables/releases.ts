import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity.ts';
import { contentReleaseStatus } from './enums.ts';

export const contentReleases = pgTable(
  'content_release',
  {
    id: text('id').primaryKey(),
    version: text('version').notNull(),
    contentHash: text('content_hash').notNull(),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
    resourceLocation: text('resource_location'),
    status: contentReleaseStatus('status').notNull().default('draft'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('content_release_version_unique').on(table.version),
    index('content_release_status_idx').on(table.status, table.publishedAt),
    check('content_release_version_length', sql`char_length(${table.version}) between 1 and 40`),
    check('content_release_hash_length', sql`char_length(${table.contentHash}) between 1 and 128`),
    check('content_release_published_at', sql`(${table.status} = 'published') = (${table.publishedAt} is not null)`),
  ],
);