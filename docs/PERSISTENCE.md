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
10. **Version what the device stores.** Use, upgrade or discard; never crash on an old or newer record.

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
pnpm dev:api                 migrates on start (development only)
cargo run -p api -- migrate          apply pending migrations and exit
cargo run -p api -- migrate --check  fail if any are pending
cargo run -p api -- prune            delete expired rows once
pnpm migrations:check        the expand/contract and immutability rules
```

## What is stored

Filled in by the phase that builds it: every table and column, its purpose and how long it is kept. A test fails when
the schema has a column this table does not list.

| Table | Column | Purpose | Kept until |
| :---- | :----- | :------ | :--------- |

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
