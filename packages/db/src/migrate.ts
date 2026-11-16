import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.ts';
import { assertManagementMigrationState, MigrationAdmissionError } from './migration-admission.ts';

/** Explicit operator command. Importing this module never opens a connection. */
export async function migrateManagementDatabase(url: string): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../drizzle/', import.meta.url));
  const expected = readMigrationFiles({ migrationsFolder });
  const handle = createDatabase({ url, maxConnections: 1 });
  let locked = false;
  try {
    await handle.client`select pg_advisory_lock(18743021)`;
    locked = true;
    const tables = await handle.client<{ name: string }[]>`
      select tablename as name from pg_catalog.pg_tables where schemaname = 'public'`;
    const hasJournal = tables.some((table) => table.name === '__drizzle_migrations');
    const rows = hasJournal
      ? await handle.client<{ hash: string }[]>`select hash from public.__drizzle_migrations order by id`
      : [];
    assertManagementMigrationState({ tables: tables.map((table) => table.name), migrationHashes: rows.map((row) => row.hash) }, expected.map((entry) => entry.hash));
    await migrate(handle.db, { migrationsFolder, migrationsSchema: 'public', migrationsTable: '__drizzle_migrations' });
  } finally {
    try { if (locked) await handle.client`select pg_advisory_unlock(18743021)`; }
    finally { await handle.close(); }
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL_REQUIRED'); process.exitCode = 1; }
  else await migrateManagementDatabase(url).catch((error: unknown) => {
    console.error(error instanceof MigrationAdmissionError ? error.message : 'DATABASE_MIGRATION_FAILED');
    process.exitCode = 1;
  });
}
