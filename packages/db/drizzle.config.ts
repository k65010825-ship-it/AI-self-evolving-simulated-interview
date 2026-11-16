import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Production sets DATABASE_URL in the environment. For local runs the repository
// keeps it in the git-ignored .env at the workspace root (see .env.example).
if (!process.env.DATABASE_URL) {
  const envFile = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find((candidate) =>
    existsSync(candidate),
  );
  if (envFile) process.loadEnvFile(envFile);
}

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  migrations: { table: '__drizzle_migrations', schema: 'public' },
  ...(url ? { dbCredentials: { url } } : {}),
});
