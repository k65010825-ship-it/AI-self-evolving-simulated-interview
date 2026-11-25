export class MigrationAdmissionError extends Error {}

/** Admission only: does not prove data/schema correctness or implement a legacy upgrade. */
export function assertManagementMigrationState(
  state: { tables: string[]; migrationHashes: string[] },
  expectedHashes: string[],
): void {
  const legacy = ['role', 'interview_session', 'interview_turn', 'agent_run', 'skill_profile', 'xp_event'];
  if (state.tables.some((table) => legacy.includes(table))) {
    throw new MigrationAdmissionError('LEGACY_DATABASE_REQUIRES_EXPLICIT_UPGRADE');
  }
  if (state.migrationHashes.length > expectedHashes.length
    || state.migrationHashes.some((hash, index) => hash !== expectedHashes[index])) {
    throw new MigrationAdmissionError('MIGRATION_HISTORY_MISMATCH');
  }
  if (state.migrationHashes.length === 0 && state.tables.some((table) => table !== '__drizzle_migrations')) {
    throw new MigrationAdmissionError('NONEMPTY_DATABASE_WITHOUT_MATCHING_HISTORY');
  }
}
