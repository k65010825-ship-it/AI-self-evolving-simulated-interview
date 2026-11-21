import type { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

/** Blank-database schema verification only. Live profile upgrades belong to the local host. */
export function applyLocalSchemaSandbox(db: Database): void {
  const version = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  const tables = db.query("select name from sqlite_master where type='table' and name not like 'sqlite_%'").all() as { name: string }[];
  if (version !== 0 || tables.some((table) => table.name.startsWith('local_'))) {
    throw new Error('LOCAL_PROFILE_REQUIRES_HOST_MIGRATION');
  }
  if (tables.length !== 0) throw new Error('LOCAL_SCHEMA_SANDBOX_REQUIRES_EMPTY_DATABASE');
  const directory = new URL('../drizzle/', import.meta.url);
  const sql = readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()
    .map((file) => readFileSync(new URL(file, directory), 'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  db.transaction(() => {
    for (const migration of sql) db.exec(migration);
    if (db.query('PRAGMA foreign_key_check').all().length) throw new Error('LOCAL_SCHEMA_FOREIGN_KEY_INVALID');
  }).immediate();
}
