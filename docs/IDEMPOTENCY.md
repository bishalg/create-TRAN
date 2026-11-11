# Idempotency playbook

Status: designed, not built. Every requirement in spec 033 is `[planned]`; this page describes what the code will do.

What it is: making a repeated request safe, so a retry, a double tap or a lost answer does the thing once.
Why it is here: a request can succeed on the server while its answer is lost, and account deletion then answers `204`
once and `401` ever after. Rules: [spec 033](./specs/033-idempotency.md). Reasons:
[ADR-0052](./adr/0052-idempotency-keys.md).

## The rules

1. **Every route names its repeat rule** (`natural`, `keyed`, `never`) in the route table, next to its rate class.
2. **Prefer `natural`:** a client-generated id with `PUT`, or a `DELETE` that answers `204` either way. Key a route
   only when its answer or its effect would differ on a repeat.
3. **`never` is for answers that carry a credential.** They are not stored, because the server keeps only digests.
4. **A keyed handler changes nothing when it answers anything but `2xx`.** Only a success is stored.
5. **One key per action.** The client mints it when the action starts, reuses it on every attempt and drops it on a
   `2xx` or when the session ends.
6. **The key is scoped to the access token, the method and the path,** and lasts one access-token lifetime.
7. **Never log, store or echo the key.** The table holds digests only.
8. **The edge decides first:** rate limit, client standing and `Origin`, then the record. A replay counts against the
   limit.
9. **A duplicate in flight gets `503` with `Retry-After: 1`.** A pending record is never taken over: the action
   happens at most once.

The header is optional. Without it a keyed route answers as before, and other routes ignore it.

## The routes

| Route                                      | Class   | Repeat rule | Why                                                   |
| ------------------------------------------ | ------- | ----------- | ----------------------------------------------------- |
| `GET /api/v1/tran/info`                    | `read`  | `natural`   | A read.                                               |
| `GET /api/v1/vote/countries`               | `read`  | `natural`   | A read.                                               |
| `GET /api/v1/vote/countries/{code}`        | `read`  | `natural`   | A read.                                               |
| `POST /api/v1/vote/eligibility`            | `read`  | `natural`   | A pure computation.                                   |
| `POST /api/v1/auth/session`                | `auth`  | `never`     | The answer carries tokens; a repeat is a new sign-in. |
| `GET /api/v1/auth/session`                 | `read`  | `natural`   | A read.                                               |
| `POST /api/v1/auth/refresh`                | `auth`  | `never`     | The answer carries tokens; replay detection is kept.  |
| `POST /api/v1/auth/sign-out`               | `auth`  | `natural`   | Answers `204` always.                                 |
| `DELETE /api/v1/account`                   | `auth`  | `keyed`     | The first answer is `204`, later ones `401`.          |
| `PUT /api/v1/devices/{installation_id}`    | `write` | `natural`   | Replaces a resource named by a client-generated id.   |
| `DELETE /api/v1/devices/{installation_id}` | `write` | `natural`   | Answers `204` either way.                             |
| `GET /api/v1/config`                       | `read`  | `natural`   | A read.                                               |

Every `GET` is `natural`, and a `never` route is in the `auth` class.

## What the server does

For a `keyed` route:

1. **Check the key.** One hyphenated version-4 UUID, else `400 request.malformed` before anything is read or written.
2. **Hash the scope and the fingerprint.** Scope: the access token's digest, the method, the path and the key.
   Fingerprint: the query string and the body bytes, never headers.
3. **Begin.** The primary key on the scope decides which of two simultaneous first requests runs.
   - No record: this request runs.
   - Same fingerprint, completed: replay (step 6).
   - Different fingerprint: `400 request.malformed`, the record unchanged.
   - Pending: `503 server.unavailable` with `Retry-After: 1`.
4. **Run the handler in its own task,** so a deadline or a disconnect cannot separate the effect from its record.
5. **Complete or release.** A `2xx` is stored (status, body, `Content-Type`). Anything else, or a panic, removes the
   pending record. If saving a success fails, the caller still gets it and a `warn` is logged.
6. **Replay.** The stored status and body come back with `Idempotent-Replayed: true` and the handler does not run.
   The record is looked up before authentication, so a revoked token still gets its `204`.

On a replay the status, body and `Content-Type` are stored. `Set-Cookie` and every other header are fresh: the
repeat's own `x-request-id` and `traceparent`, `Cache-Control: no-store`, the security headers and the update nudge.
Records expire after one access-token lifetime and are removed by the prune (`database pruned`, field `idempotency`).

## What a client does

| Platform | Call                                                                                                        | Mint                  | Held in     | Dropped                                        |
| -------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ----------- | ---------------------------------------------- |
| Web      | `SessionClient.deleteAccount` (`packages/api/src/session.ts`)                                               | `crypto.randomUUID()` | Memory only | On `2xx`, sign-out, a new sign-in, or recovery |
| iOS      | `TranSessionClient.deleteAccount` (`apps/ios/Sources/TranVotingDemo/Session/TranSessionClient.swift`)       | `UUID()`              | Memory only | The same                                       |
| Android  | `SessionClient.deleteAccount` (`apps/android/app/src/main/kotlin/com/tran/voting/session/SessionClient.kt`) | `UUID.randomUUID()`   | Memory only | The same                                       |

- Reuse the key on every attempt of one deletion, including the repeat after a token refresh and the person's next
  tap after a failure.
- Send it on `keyed` routes only. Never retry a deletion automatically.
- Treat a replayed answer as the original; ignore `Idempotent-Replayed`.
- Take both header names from the generated contract, never spell them by hand.
- **No outbox exists.** No client queues a mutation for replay after a relaunch, so nothing is kept across launches.

## Adding a keyed route

1. Add or find the requirement in spec 033 (`REQ-IDEM-NNN`, `[planned]` until tested).
2. Give the route `keyed` in the route table. The tests `every_route_names_its_repeat_rule` and
   `the_sample_keys_account_deletion_only` change with it.
3. Make the handler change nothing when it answers anything but `2xx`.
4. Make each client mint and hold the key per the rules above.
5. CORS already allows `Idempotency-Key`; check it still does.
6. Test a replay, a mismatch, an in-flight repeat and a failure that is not remembered.

## Where it lives

- `crates/rust-core/src/idempotency.rs` (planned): `RouteRepeat`, `IDEMPOTENCY_POLICY`, `parse_idempotency_key`.
- `crates/rust-core/src/compat.rs`: `IDEMPOTENCY_KEY_HEADER`, `IDEMPOTENT_REPLAYED_HEADER` (planned), emitted by
  `pnpm tokens:sync`.
- `apps/api/src/idempotency.rs` (planned): the `IdempotencyStore` trait, scope and fingerprint.
- `apps/api/src/middleware/idempotency.rs` (planned): the step inside the route.
- `apps/api/src/db/idempotency_store.rs` (planned): the SQL store.
- `apps/api/migrations/0002_idempotency_keys.sql` (planned): the table (the number is the next free one).
- `apps/api/src/routes/table.rs`: the repeat rule of each route (planned column).

## What a fork changes

- **With an outbox:** scope by user, keep records for hours, add a `user_id` column that account erasure deletes,
  and persist the key with the queued request.
- **For money:** record the answer in the same transaction as the effect, instead of running the request in its own
  task.
- **For PostgreSQL:** begin with `INSERT … ON CONFLICT DO NOTHING`.
- **Several processes:** already safe, because the record is in the database.
