# 030 Persistence and migrations

Scope: how the Axum API (`apps/api`) keeps sessions and device registrations across restarts, how its schema changes
over time without breaking a running version, and how the records each client stores on the device (`apps/web`,
`apps/ios`, `apps/android`) are versioned. Builds on [022](022-security.md) (`SessionStore`), [024](024-account-deletion.md)
(`AccountEraser`), [027](027-push-and-devices.md) (`DeviceStore`) and [028](028-api-versioning.md) (old and new
versions run side by side). Rationale: [ADR-0049](../adr/0049-sqlite-first-forward-only-migrations.md). Playbook:
[`../PERSISTENCE.md`](../PERSISTENCE.md).

Vocabulary used below:

- A **migration** is one numbered SQL file that moves the schema forward. It is never edited after it has shipped and
  there are no "down" migrations.
- **Expand, then contract**: add the new shape first (expand), ship code that uses it, and remove the old shape in a
  later release (contract), so the version still running during a deploy never meets a schema it cannot use.
- A **stored record** on a device is anything the app writes and reads back after an update: the session vault, the
  push record, the cached configuration.

## The API

### REQ-DB-001 [verified] One store implementation, the one that runs in production

`SessionStore`, `DeviceStore` and the erasure path MUST be implemented on SQL (SQLite), and that implementation MUST be
the only one: tests run it against an in-memory database, so no test passes on a store production never uses. The
hand-written in-memory stores are removed. The database is named by `DATABASE_URL` (a `Secret`); unset, the API uses a
local file under `./data/`, so the sample still starts with no setup.
**Verified by:** the existing `auth_test.rs`, `account_test.rs`, `devices_test.rs` and `push_test.rs`, unchanged in
behaviour, running on the SQL stores.

### REQ-DB-002 [verified] Migrations are forward-only, numbered, embedded and checked

Migrations MUST be files `apps/api/migrations/NNNN_<name>.sql`, embedded in the binary, applied in order, each in one
transaction, and recorded in a `schema_migrations` table with a checksum. Start-up MUST refuse to serve when an applied
migration's checksum differs from the embedded file, when the database holds a migration the binary does not know (a
newer schema than this version understands is reported, not "fixed"), or when numbers have a gap or a duplicate.
**Verified by:** `apps/api/tests/migrations_test.rs`.

### REQ-DB-003 [verified] Migrating is a deliberate step, separate from serving

`api migrate` MUST apply pending migrations and exit; `api migrate --check` MUST exit non-zero when any are pending
and change nothing. The server MUST apply pending migrations at start-up only when `MIGRATE_ON_START` is `true` (the
default in `development` and `test`); in any other environment it MUST refuse to start with pending migrations and say
to run `api migrate`. Two processes migrating at once MUST NOT both apply the same migration.
**Verified by:** `migrations_test.rs`.

### REQ-DB-004 [verified] The schema is a reviewed snapshot

Applying every migration to an empty database MUST produce exactly `apps/api/schema.sql`, which is committed. A test
MUST fail when they differ, so a schema change always shows as a readable diff in review.
**Verified by:** `migrations_test.rs` (`schema_snapshot_is_current`).

### REQ-DB-005 [verified] A migration never breaks the version that is still running

A migration MUST be usable by the previous release's code (expand, then contract). `pnpm migrations:check` MUST fail on
a migration that drops or renames a table or column, adds a `NOT NULL` column without a default, or tightens a
constraint, unless the file carries `-- contract: <reason and the release that stopped using it>`; and it MUST fail
when a migration that has already been released (present at the last release tag) is changed or removed.
**Verified by:** `tooling/migrations/migrations.test.mjs`.

### REQ-DB-006 [verified] Operations that must happen together happen in one transaction

Each of these MUST be one transaction: rotating a refresh token (REQ-SEC-009); revoking a session and its device
registrations (REQ-PSH-003); erasing an account with every session and registration (REQ-ACC-001); moving a push token
to its newest owner (REQ-PSH-002). A failure part-way MUST leave nothing changed.
**Verified by:** store tests that inject a failure between the steps.

### REQ-DB-007 [verified] Concurrent requests cannot both win

Two concurrent rotations of the same refresh token MUST produce exactly one new pair, and the other MUST be treated as
a replay (REQ-SEC-010). Two concurrent registrations of one push token MUST leave exactly one registration.
**Verified by:** `apps/api/tests/concurrency_test.rs` (many parallel attempts, repeated).

### REQ-DB-008 [verified] Database work never blocks the request runtime, and is bounded

Store calls MUST NOT block the async executor, MUST wait at most `DB_POLICY.busy_timeout_ms` for a lock, and a store
failure MUST answer `503 server.unavailable` in the envelope with one logged event, never a panic and never the SQL
text. SQLite MUST run with write-ahead logging and foreign keys enforced.
**Verified by:** `apps/api/tests/store_failure_test.rs`.

### REQ-DB-009 [verified] Expired data is removed on a schedule

Sessions past their refresh lifetime, spent tokens older than the refresh lifetime and stale device registrations
(REQ-PSH-005) MUST be deleted by a prune task that runs on an interval from `DB_POLICY` and on the injected clock.
`api prune` MUST run it once. The task MUST log how many rows it removed and nothing about them.
**Verified by:** `apps/api/tests/prune_test.rs`.

### REQ-DB-010 [verified] The database holds no more than it needs

The schema MUST store token digests, never tokens (REQ-SEC-006); MUST NOT store anything the API does not read back;
and every column MUST be listed, with its purpose and retention, in the table of `docs/PERSISTENCE.md`. A test MUST
fail when the snapshot has a column the table does not list.
**Verified by:** `tooling/migrations/migrations.test.mjs`.

## The clients

### REQ-DB-011 [verified] Every stored record on a device carries a version

The session vault record, the push record and any cached server answer MUST carry a `schema` number. Reading MUST go
through one Rust decision, `stored_record(schema, current)`, pinned by `fixtures/stored-records.json`: the current
version is used; an older one is upgraded by a pure, fixture-tested function; a newer or unreadable one is discarded
and treated as absent (signed out; defaults), never a crash.
**Verified by:** the fixture on every platform; `StoredRecordTests.swift`, `StoredRecordTest.kt`,
`packages/api/tests/stored-record.test.ts`.

### REQ-DB-012 [verified] An app update keeps the person signed in

A record written by the previous released client version MUST be readable by the current one. Each release MUST add
the records it writes to `fixtures/stored-records.json`, and the tests MUST read every kept version.
**Verified by:** the platform stored-record tests over the kept versions.
