/**
 * Append-only profile extension introduced after the host-managed profile v3 schema.
 *
 * This is NOT part of the blank-database Drizzle baseline in ../schema.ts. The 24-table
 * baseline is a disposable projection sandbox; these tables are written by the local host
 * on the existing profile.sqlite connection. They must be created through upgrade.ts so the
 * host lease, backup and rollback rules are applied.
 */
export const PROFILE_SCHEMA_VERSION = 4 as const;
export const PROFILE_UPGRADE_SOURCE_VERSION = 3 as const;

/** The 17 authoritative tables created by feature/agent profile v3. */
export const PROFILE_V3_TABLES = [
  'local_control',
  'local_sessions',
  'local_memory',
  'local_jobs',
  'local_events',
  'local_budget',
  'local_session_budgets',
  'local_live_grants',
  'local_model_checkpoints',
  'local_live_reconciliations',
  'local_resource_budgets',
  'local_speech_grants',
  'local_speech_grant_versions',
  'local_speech_attempts',
  'local_speech_reconciliations',
  'local_speech_tasks',
  'local_speech_links',
] as const;

export const PROFILE_V4_TABLES = [
  'local_business_operations',
  'local_hint_journals',
  'local_learning_records',
  'local_experiment_records',
] as const;

export const PROFILE_V4_INDEXES = [
  'local_business_operations_record_idx',
  'local_hint_journals_pending_idx',
  'local_hint_journals_session_idx',
  'local_learning_records_role_idx',
  'local_experiment_records_role_idx',
  'local_experiment_records_pending_idx',
] as const;

export const PROFILE_V4_TRIGGERS = [
  'local_business_operations_owner_insert',
  'local_business_operations_owner_update',
  'local_hint_journals_owner_insert',
  'local_hint_journals_owner_update',
  'local_learning_records_owner_insert',
  'local_learning_records_owner_update',
  'local_experiment_records_owner_insert',
  'local_experiment_records_owner_update',
] as const;

/**
 * DDL for profile v3 -> v4. Executed inside the host's existing write transaction.
 * Every table carries the profile-wide operation ledger; user_id is guarded against
 * local_control.profile_id by triggers so a repository cannot write another profile.
 */
export const PROFILE_V4_DDL = `
CREATE TABLE local_business_operations (
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hint', 'learning', 'experiment')),
  record_id TEXT NOT NULL,
  digest TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (user_id, operation_id),
  CHECK (length(operation_id) BETWEEN 1 AND 100),
  CHECK (length(record_id) BETWEEN 1 AND 100),
  CHECK (
    (kind = 'hint' AND digest IS NULL) OR
    (kind IN ('learning', 'experiment') AND digest IS NOT NULL
      AND length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*')
  )
) WITHOUT ROWID;

CREATE INDEX local_business_operations_record_idx
  ON local_business_operations (user_id, kind, record_id);

CREATE TABLE local_hint_journals (
  user_id TEXT NOT NULL,
  issue_id TEXT NOT NULL CHECK (length(issue_id) = 64 AND issue_id NOT GLOB '*[^0-9a-f]*'),
  role_id TEXT NOT NULL CHECK (role_id IN ('java-backend', 'web-frontend')),
  session_id TEXT NOT NULL REFERENCES local_sessions (session_id) ON DELETE RESTRICT,
  question_id TEXT NOT NULL CHECK (length(question_id) BETWEEN 1 AND 100),
  issued_at INTEGER NOT NULL CHECK (issued_at >= 0),
  journal_limit INTEGER NOT NULL CHECK (journal_limit = 2),
  version INTEGER NOT NULL CHECK (version >= 0),
  committed_count INTEGER NOT NULL CHECK (committed_count BETWEEN 0 AND 2),
  reserved_count INTEGER NOT NULL CHECK (reserved_count BETWEEN 0 AND 1),
  body TEXT NOT NULL CHECK (json_valid(body)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (user_id, issue_id),
  CHECK (committed_count + reserved_count <= 2)
) WITHOUT ROWID;

CREATE INDEX local_hint_journals_pending_idx
  ON local_hint_journals (user_id, reserved_count) WHERE reserved_count > 0;
CREATE INDEX local_hint_journals_session_idx
  ON local_hint_journals (user_id, session_id, updated_at);

CREATE TABLE local_learning_records (
  user_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL CHECK (length(assignment_id) BETWEEN 1 AND 100),
  role_id TEXT NOT NULL CHECK (role_id IN ('java-backend', 'web-frontend')),
  version INTEGER NOT NULL CHECK (version >= 0),
  body TEXT NOT NULL CHECK (json_valid(body)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (user_id, assignment_id)
) WITHOUT ROWID;

CREATE INDEX local_learning_records_role_idx
  ON local_learning_records (user_id, role_id, updated_at);

CREATE TABLE local_experiment_records (
  user_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL CHECK (length(experiment_id) BETWEEN 1 AND 100),
  role_id TEXT NOT NULL CHECK (role_id IN ('java-backend', 'web-frontend')),
  version INTEGER NOT NULL CHECK (version >= 0),
  pending_run_count INTEGER NOT NULL CHECK (pending_run_count BETWEEN 0 AND 200),
  body TEXT NOT NULL CHECK (json_valid(body)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (user_id, experiment_id)
) WITHOUT ROWID;

CREATE INDEX local_experiment_records_role_idx
  ON local_experiment_records (user_id, role_id, updated_at);
CREATE INDEX local_experiment_records_pending_idx
  ON local_experiment_records (user_id, pending_run_count) WHERE pending_run_count > 0;

CREATE TRIGGER local_business_operations_owner_insert
BEFORE INSERT ON local_business_operations
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_business_operations_owner_update
BEFORE UPDATE ON local_business_operations
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_hint_journals_owner_insert
BEFORE INSERT ON local_hint_journals
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_hint_journals_owner_update
BEFORE UPDATE ON local_hint_journals
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_learning_records_owner_insert
BEFORE INSERT ON local_learning_records
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_learning_records_owner_update
BEFORE UPDATE ON local_learning_records
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_experiment_records_owner_insert
BEFORE INSERT ON local_experiment_records
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;

CREATE TRIGGER local_experiment_records_owner_update
BEFORE UPDATE ON local_experiment_records
WHEN NOT EXISTS (SELECT 1 FROM local_control WHERE id = 1 AND profile_id = NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_OWNER_MISMATCH'); END;
`;
