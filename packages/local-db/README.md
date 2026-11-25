# Local business schema and projections

This is a proposed extension/read-model schema, not a second runtime or a replacement for the existing Agent profile v3. Authoritative sessions, memory, tasks/events, receipts and multimodal budgets remain in the existing 17 local_* tables. See ../../docs/database.md for the ownership/mapping contract.

- Do not execute these baseline migrations against profile.sqlite, create a second authoritative user database, or switch runtime writes to these tables.
- applyLocalSchemaSandbox in src/sandbox.ts is an empty-database verification helper. It rejects versioned/nonempty/profile databases before DDL. It is not an upgrade API and does not write user_version.
- A real integration requires a host-owned backup/versioned migration using the existing connection, explicit source revision/digest mapping, and restart/receipt/unknown-cost tests. That integration is not implemented here.
- Keep local internal foreign keys, but do not reference server account/content tables. Text IDs referring to remote content must be paired with pinned versions/digests at the integration layer.
- Normalized agent_run/run_event/idempotency_record/budget_ledger are diagnostics/read models only, not execution/commit/accounting authorities. Do not treat their presence as a production budget loop.

## Profile v3 -> v4 upgrade and business repositories

`src/profile/upgrade.ts` implements the host-managed upgrade required by `docs/database.md` §8.1. It is deliberately not part of the Drizzle baseline above.

```ts
import { upgradeProfileV3ToV4 } from '@interview/local-db/profile';

// Inside the existing profile.write(db => ...) transaction, after v1/v2 -> v3.
const result = upgradeProfileV3ToV4(db, {
  profileDir: profile.path,
  profileId: profile.profileId,
  owner: profile.owner,
  fence: profile.fence,
  now: Date.now(), // optional
});
// result.backup = { file, digest, schemaVersion: 3 }
```

Integration rules:

1. Keep using the host's single `bun:sqlite` connection and its write transaction. The function never opens a second writer, never starts/commits a transaction, and never awaits.
2. Raise the host's accepted `PRAGMA user_version` to 4. For an existing v3 profile call the module inside the same startup transaction; for v1/v2 run the existing host migration to v3 first. A version above 4 must still be rejected.
3. The module verifies the `local_control` owner/fence/lease/profile binding, requires the exact 17 v3 tables, writes and verifies `profileDir/backups/v3-<uuid>.sqlite` (integrity_check, user_version=3, sha256 manifest), then creates the v4 tables, compares the pre/post digest of all 17 authoritative tables, runs `foreign_key_check`/`integrity_check`, and only then sets `user_version = 4`.
4. Any error must propagate to the host transaction. DDL and version changes roll back; the pre-upgrade backup file intentionally remains for diagnosis.
5. `backup: false` is only for a profile created from an empty database in the same startup.

The v4 extension adds four tables:

- `local_business_operations`: profile-wide `(user_id, operation_id)` ledger shared by hints, learning and experiments; a reused id with different kind/record/digest is rejected.
- `local_hint_journals`: one `HintJournal` per `(user_id, issue_id)`, with derived committed/reserved counts and a bounded pending index.
- `local_learning_records`: one learning record per `(user_id, assignment_id)` with CAS version.
- `local_experiment_records`: one offline experiment record per `(user_id, experiment_id)` with CAS version and a pending-run count.

Formal repositories:

```ts
import {
  createHintRepository,
  createLearningRepository,
  createExperimentRepository,
} from '@interview/local-db/repositories';

const hints = createHintRepository();
const learning = createLearningRepository<LocalLearningRecord>();
const experiments = createExperimentRepository<LocalExperimentRecord>();
// Pass these through createLocalHost({ hints, learning, experiments }).
```

All methods are synchronous and take the host's `Database`. `save` enforces CAS (`null` = insert), requires a strictly newer version, claims every operation receipt against the profile-wide ledger, and writes the full record in the same transaction. `findOperation` is profile-wide and fails closed if an id belongs to another module. Hint `pending` returns at most 4000 journals and throws above that limit; experiment `pending` returns records with queued/running runs so the host can mark them `interrupted`.

The repository types in `src/repositories/contracts.ts` are structural mirrors of the feature/agent ports because the shared hint/learning/experiment contracts live on that branch. After the branches merge, pass the shared record types as the generic argument (as above) or replace the mirror with `import type` from `@interview/contracts`; runtime behavior does not change.

Verify with:

```powershell
bun test tests/local-profile-upgrade.test.ts tests/local-repositories.test.ts
bun run typecheck
```
