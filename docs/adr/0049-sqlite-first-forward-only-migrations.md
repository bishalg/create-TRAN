# ADR-0049 SQLite first, one store implementation, forward-only migrations

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [030](../specs/030-persistence-and-migrations.md)

## Context

Sessions and device registrations lived in process memory behind traits (ADR-0039, ADR-0044). A restart signed
everyone out and forgot every device, two processes could not share state, and the rules a real database imposes
(transactions, concurrent writers, schema change under a running version) were never exercised. Those rules are where
production incidents come from: a migration that locks a table, a column dropped while the old version still reads
it, a rename that needs both versions deployed at once, two requests that both rotate the same token, a "down"
migration that was never tested until the night it was needed, and an edited migration that makes two environments
quietly different.

The template also promises to start in minutes with no setup (ADR-0015).

## Decision

1. **SQLite is the shipped database.** It is real SQL with transactions, constraints and migrations, and it needs no
   server, so the sample keeps starting with one command. A fork moves to PostgreSQL behind the same traits; the
   playbook lists what changes.
2. **One implementation.** The in-memory stores are deleted and tests run the SQL stores against an in-memory
   database. A test that passes on a fake store proves nothing about the one in production.
3. **Migrations are forward-only SQL files,** numbered, embedded, applied in a transaction, recorded with a checksum.
   No down migrations: a mistake is fixed by the next migration, which is the only kind that is ever tested.
4. **A shipped migration is immutable.** Start-up and a repo check both fail on a changed checksum.
5. **Migrating is separate from serving** outside development. A deploy runs `api migrate` once, then starts the new
   version; a server that finds pending migrations refuses to start rather than racing its siblings.
6. **Expand, then contract.** A migration must work with the previous release's code, because during a deploy both
   run at once (and ADR-0047 keeps old apps alive much longer). Destructive statements need a written reason naming
   the release that stopped using the thing.
7. **The schema is a committed snapshot,** so every change is a diff someone reads.
8. **What must be atomic is one transaction,** and what must not happen twice is decided by the database, not by
   application checks.
9. **Data has a retention.** Expired sessions and stale devices are pruned on a schedule, and every column is listed
   with its purpose.
10. **Device records are versioned too.** The same problem exists on the phone: an updated app reads what the old one
    wrote. One Rust decision says use, upgrade or discard.

## Consequences

- SQLite allows one writer at a time and lives on one machine's disk. That is enough for the sample and for a small
  product; it is the first thing a fork that runs several API processes replaces.
- The API gains a database library. Store calls leave the async executor so a slow query cannot stall other requests.
- Tests get slightly slower and much more honest.
- There is no automatic rollback of a bad migration. The deploy pipeline phase pairs this with "migrate first, then
  roll out, and keep the previous version able to run against the new schema", which is what makes rolling back the
  code safe.
- Backups, restore drills and encryption at rest are a fork's responsibility; the playbook says so.
