# Legacy 44-table PostgreSQL baseline

Archived unchanged from master before the management-domain split. These SQL/journal/snapshot files explain already-created development databases; they are not part of the new management migration folder and must not be replayed alongside it.

The new 25-table management baseline is for verified empty databases only. `db:migrate` checks public table names and the applied migration hashes before invoking the migrator, and refuses legacy or mismatched histories. It does not convert legacy student data. Existing databases require a separately reviewed backup/export/mapping plan; never clear the migration journal or drop data to make the baseline pass.
