# Local business schema and projections

This is a proposed extension/read-model schema, not a second runtime or a replacement for the existing Agent profile v3. Authoritative sessions, memory, tasks/events, receipts and multimodal budgets remain in the existing 17 local_* tables. See ../../docs/database.md for the ownership/mapping contract.

- Do not execute these baseline migrations against profile.sqlite, create a second authoritative user database, or switch runtime writes to these tables.
- applyLocalSchemaSandbox in src/sandbox.ts is an empty-database verification helper. It rejects versioned/nonempty/profile databases before DDL. It is not an upgrade API and does not write user_version.
- A real integration requires a host-owned backup/versioned migration using the existing connection, explicit source revision/digest mapping, and restart/receipt/unknown-cost tests. That integration is not implemented here.
- Keep local internal foreign keys, but do not reference server account/content tables. Text IDs referring to remote content must be paired with pinned versions/digests at the integration layer.
- Normalized agent_run/run_event/idempotency_record/budget_ledger are diagnostics/read models only, not execution/commit/accounting authorities. Do not treat their presence as a production budget loop.
