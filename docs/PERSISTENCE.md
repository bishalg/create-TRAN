# Persistence and migrations playbook

What it is: where the API keeps data, how the schema changes, and how records stored on a device survive an app
update. Why it is here: schema changes and concurrent writes cause most production incidents, and they cannot be
practised on in-memory stores. Rules: [spec 030](./specs/030-persistence-and-migrations.md). Reasons:
[ADR-0049](./adr/0049-sqlite-first-forward-only-migrations.md).

## The rules

1. **One store implementation.** Tests run the SQL stores on an in-memory database. No fakes of the database.
2. **Forward only.** A migration is a numbered SQL file; there is no "down". Fix a mistake with the next migration.
3. **Never edit a shipped migration.** The checksum check will stop the server.
4. **Expand, then contract.** Add the new shape, ship code that uses it, remove the old shape in a later release.
   The previous version must run against the new schema.
5. **Migrate, then serve.** In production run `api migrate` as its own step; the server refuses to start with pending
   migrations.
6. **One transaction for what belongs together;** let a constraint, not an `if`, decide what cannot happen twice.
7. **Never block the request runtime** on the database, and bound every wait.
8. **Store the least, and give it an end date.** Digests instead of tokens; prune expired rows on a schedule.
9. **Read the schema diff.** `apps/api/schema.sql` changes in the same commit as the migration.
10. **Version what the device stores.** Use, upgrade or discard; never crash, never rewrite on read, never destroy a
    newer version's record.

## Changing the schema

| You want to            | Release N                                         | Release N+1                                   |
| :--------------------- | :------------------------------------------------ | :-------------------------------------------- |
| Add a column           | Add it nullable or with a default; code writes it | (optional) make it required                   |
| Rename a column        | Add the new one; write both; read the new         | Drop the old (`-- contract:` with the reason) |
| Drop a column or table | Stop reading and writing it                       | Drop it (`-- contract:`)                      |
| Add a constraint       | Clean the data; add it only if old code obeys it  |                                               |
| Change a type          | Treat as a rename                                 |                                               |

## Commands

```
pnpm dev:api                         serve; migrates on start (MIGRATE_ON_START, on in development and test)
cargo run -p api -- migrate          apply pending migrations and exit
cargo run -p api -- migrate --check  exit 1 if any are pending; changes nothing
cargo run -p api -- prune            delete expired rows once and exit (the server also does it hourly)
pnpm migrations:check                the expand/contract, immutability and "what is stored" rules
pnpm schema:snapshot                 rewrite apps/api/schema.sql after adding a migration
```

`DATABASE_URL` names the database: `sqlite:<path>` or `sqlite::memory:`. Unset, the API uses `data/api.sqlite3`
under the working directory (the repository root for `pnpm dev:api`) and creates the folder; `data/` is ignored by
git. To start again from an empty database, stop the API and delete `data/`. The e2e and smoke runs use
`sqlite::memory:`, so every run starts empty and leaves nothing behind.

A store failure (the database locked past `DB_POLICY.busy_timeout_ms`, or broken) answers
`503 server.unavailable`, retryable, and logs one `request failed` event without SQL. Store calls run on tokio's
blocking pool through `Sessions::blocking`, never on the request runtime; one connection per process is the single
writer, and every write transaction takes SQLite's lock first (`BEGIN IMMEDIATE`), so another process waits for it.

## What is stored

Every table and column, its purpose and how long it is kept. Times are Unix microseconds, UTC. `pnpm migrations:check`
fails when `apps/api/schema.sql` has a column this table does not list, or the table lists one the schema lacks.

| Table                  | Column            | Purpose                                                                    | Kept until                                                                    |
| :--------------------- | :---------------- | :------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| `sessions`             | `id`              | Names one sign-in (token family); never reused                             | Sign-out, a replayed refresh token, account deletion, or its refresh lifetime |
| `sessions`             | `user_id`         | Whose session it is, for `who am I` and account deletion                   | As the row                                                                    |
| `sessions`             | `role`            | The role the session acts as                                               | As the row                                                                    |
| `sessions`             | `transport`       | Cookie or body: how the refresh token travels (REQ-SEC-007)                | As the row                                                                    |
| `access_tokens`        | `digest`          | SHA-256 of an access token, never the token (REQ-SEC-006)                  | Its expiry (pruned), or its session's end                                     |
| `access_tokens`        | `session_id`      | The session it authenticates                                               | As the row                                                                    |
| `access_tokens`        | `expires_at`      | When it stops working                                                      | As the row                                                                    |
| `refresh_tokens`       | `digest`          | SHA-256 of a refresh token, never the token (REQ-SEC-006)                  | Its expiry, spent or not (pruned), or its session's end                       |
| `refresh_tokens`       | `session_id`      | The session it renews                                                      | As the row                                                                    |
| `refresh_tokens`       | `expires_at`      | When it stops working; a session with none left is pruned                  | As the row                                                                    |
| `refresh_tokens`       | `spent`           | Already rotated once: presenting it again is a replay (REQ-SEC-010)        | As the row                                                                    |
| `device_registrations` | `installation_id` | The app install the registration belongs to (REQ-PSH-010)                  | Unregistered, its session revoked, a dead token, or 60 days unrefreshed       |
| `device_registrations` | `user_id`         | Whose devices to notify; account deletion removes them                     | As the row                                                                    |
| `device_registrations` | `session_id`      | The session it was made in; revoking that session removes it               | As the row                                                                    |
| `device_registrations` | `platform`        | Which push service sends to it (APNs or FCM)                               | As the row                                                                    |
| `device_registrations` | `environment`     | Which APNs gateway (sandbox or production)                                 | As the row                                                                    |
| `device_registrations` | `push_token`      | Where the push service delivers; unique, so a token has one owner          | As the row                                                                    |
| `device_registrations` | `locale`          | The language the notification text is written in                           | As the row                                                                    |
| `device_registrations` | `app_version`     | The app build that registered (REQ-PSH-001); read back, not yet decided on | As the row                                                                    |
| `device_registrations` | `marketing`       | The person opted in to marketing messages (REQ-PSH-006)                    | As the row                                                                    |
| `device_registrations` | `refreshed_at`    | Last registration; 60 days without one makes it stale (REQ-PSH-005)        | As the row                                                                    |
| `schema_migrations`    | `version`         | Which migration is applied (REQ-DB-002)                                    | For the life of the database                                                  |
| `schema_migrations`    | `name`            | Its file name, for messages                                                | For the life of the database                                                  |
| `schema_migrations`    | `checksum`        | SHA-256 of the file as applied; a changed file stops start-up              | For the life of the database                                                  |

## Records on the device

Each record a client keeps (the session vault, the push registration, the config cache) carries `schema`; none is the
first release (version 1). What is true today:

- **One rule in the core.** `stored_schema` (which values are versions: whole numbers 1 to 4294967295) and
  `stored_record(schema, current)` (use, upgrade, discard) live in `crates/rust-core/src/stored_records.rs`; native code
  calls the decision over UniFFI. Only the decision and the current numbers cross the bridge, never a record, so a
  refresh token never leaves native code.
- **Field mapping is per platform.** Each store reads its own bytes (`KeychainSessionVault`, `KeystoreSessionVault`,
  `TranPushStore`, `PushPreferences`, both `RemoteConfigStore`s). The proof is the fixture: every case in
  `fixtures/stored-records.json` is written as the real stored item and read back through the real store.
- **After a read.** Used: left as it is (an upgrade is not written back; the next ordinary write stores the current
  version). Newer: treated as absent and left for the version that wrote it. Unreadable: deleted (REQ-SEC-020).
- **Every upgrade is the identity today.** Current is 2 so the upgrade path is exercised; nothing has changed shape.

A fork that changes a record's shape: bump its `CURRENT_*_SCHEMA`, add the step from the previous version in that
record's reader on each platform (the decision already says `upgrade`), add a fixture case with the old shape and what
it reads as, and keep every older case. There is no migration framework; the steps are a few lines per platform.

## Where it lives

| Part                           | Place                                                                    |
| :----------------------------- | :----------------------------------------------------------------------- |
| Migrations and schema snapshot | `apps/api/migrations/`, `apps/api/schema.sql`                            |
| SQL stores                     | `apps/api/src` (behind `SessionStore`, `DeviceStore`)                    |
| Stored-record versions         | `crates/rust-core/src/stored_records.rs`, `fixtures/stored-records.json` |

## What a fork changes for PostgreSQL

- The connection (a pool) and the SQL dialect of the stores and migrations; the traits, tests and rules stay.
- The migration lock becomes an advisory lock; long migrations need `CONCURRENTLY` and lock timeouts.
- Add backups with a restore drill, encryption at rest, and a read-only replica if reads need it.
