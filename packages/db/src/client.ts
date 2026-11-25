import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type PostgresClient = ReturnType<typeof postgres>;
export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  client: PostgresClient;
  close: () => Promise<void>;
}

export interface DatabaseOptions {
  url?: string;
  maxConnections?: number;
}

/**
 * Opens a PostgreSQL connection pool. Only the management API or explicit operator migrations own this handle;
 * renderer and Agent code must not import it.
 */
export function createDatabase(options: DatabaseOptions = {}): DatabaseHandle {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not configured; refusing to open a PostgreSQL connection.');
  }
  const client = postgres(url, { max: options.maxConnections ?? 10 });
  return {
    db: drizzle(client, { schema }),
    client,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
