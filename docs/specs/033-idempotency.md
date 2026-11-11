# 033 Idempotency keys

Scope: how the Axum API (`apps/api`) makes a repeated request safe: a client's retry after a timeout or a `5xx`,
the person trying again after an error, or a request whose answer was lost. Also what the clients (`apps/web` through
`@tran/api`, `apps/ios`, `apps/android`) send. Builds on [011](011-error-feedback.md) (retry policy, REQ-ERR-005),
[012](012-failure-modes.md) (deadline, panics, REQ-ROB-003/004), [022](022-security.md) (tokens kept as digests),
[024](024-account-deletion.md) (the device is cleared only after `204`, REQ-ACC-006), [028](028-api-versioning.md)
(add, never change), [030](030-persistence-and-migrations.md) (one SQL store, forward-only migrations, prune) and
[031](031-rate-limiting.md) (route classes). Rationale: [ADR-0052](../adr/0052-idempotency-keys.md). Playbook:
[`../IDEMPOTENCY.md`](../IDEMPOTENCY.md).

Vocabulary used below:

- A **repeat** is the same request sent again: an automatic retry, the person's next tap after a failure, or the
  repeat that follows a token refresh.
- Every route has a **repeat rule** in the route table:
  - `natural`: repeating it changes nothing more and answers the same (reads, pure computations, `PUT` replace, a
    `DELETE` that answers `204` either way, sign-out).
  - `keyed`: an `Idempotency-Key` makes the effect happen once and keeps the answer.
  - `never`: the answer carries a credential, which may not be stored, so a repeat is a new request and the session
    rules make it safe.
- An **idempotency key** is a random UUID a client mints for one action.
- The **scope** of a keyed request is its access token, method, path and key. The **fingerprint** is SHA-256 of its
  query string and body.
- A **record** is what the API keeps for one scope: **pending** while the first request runs, then **completed** with
  its answer.

### REQ-IDEM-001 [planned] The policy is Rust data

`crates/rust-core/src/idempotency.rs` MUST define:

- `RouteRepeat` (`Natural`, `Keyed`, `Never`);
- `IDEMPOTENCY_POLICY`, with `retention_seconds` equal to `SESSION_POLICY.access_ttl_seconds` (a compile-time
  assertion) and `in_flight_retry_after_seconds` (`1`);
- `parse_idempotency_key`.

`crates/rust-core/src/compat.rs` MUST define `IDEMPOTENCY_KEY_HEADER` (`Idempotency-Key`) and
`IDEMPOTENT_REPLAYED_HEADER` (`Idempotent-Replayed`). `pnpm tokens:sync` MUST emit both to
`packages/api/src/generated/compat.ts`, `ApiContract.swift` and `ApiContract.kt`. No client may spell either name by
hand.
**Verified by:** `idempotency.rs` unit tests; `compat_gen.rs` tests; `crates/tran-tokens-codegen/tests/generated_files.rs`
(drift).

### REQ-IDEM-002 [planned] Every route names its repeat rule

The route table MUST give every route a `RouteRepeat`, just as it gives a rate class (REQ-RL-001), so a new route
cannot be added without answering "what happens if this is sent twice?". Every `GET` MUST be `natural`, and a `never`
route MUST be in the `auth` class. In the sample:

- `keyed`: `DELETE /api/v1/account`.
- `never`: `POST /api/v1/auth/session` and `POST /api/v1/auth/refresh`.
- `natural`: every other route.
  **Verified by:** `routes/table.rs` unit tests `every_route_names_its_repeat_rule` and `the_sample_keys_account_deletion_only`.

### REQ-IDEM-003 [planned] The key is optional, so the change is additive

A `keyed` route that receives no `Idempotency-Key` MUST answer exactly as it did before this spec and keep no record.
A `natural` or `never` route MUST ignore the header, valid or not. Every released client therefore keeps working
(REQ-VER-002, REQ-VER-003).
**Verified by:** `apps/api/tests/idempotency_test.rs` (`without_a_key_a_deletion_behaves_as_before`,
`other_routes_ignore_the_header`); `client_replay_test.rs` replaying `fixtures/contract/clients/*/0.1.0.json` (which
send no key) unchanged; `pnpm contract:check`.

### REQ-IDEM-004 [planned] A key is one random UUID

On a `keyed` route the header MUST be a single value: a hyphenated version-4 UUID of 36 characters, in either case,
compared in lowercase. Anything else MUST answer `400 request.malformed` with the fixed message `Idempotency-Key must
be one random UUID`, before any record is read or written and before the handler runs. This covers an empty value,
another UUID version, braces, a URN, a UUID without hyphens, and the header given twice. The message never echoes
the value.
**Verified by:** `idempotency.rs` unit tests (`parse_idempotency_key`); `idempotency_test.rs`
`a_malformed_key_is_rejected_before_anything_runs`.

### REQ-IDEM-005 [planned] A key is scoped to the access token, the method and the path

A record MUST be found only by the same access token, method, path and key. The same key sent with another token,
another user or to another route MUST be treated as an independent request. A keyed request without a bearer token
MUST NOT be recorded; the handler answers `401` as usual. The scope MUST be stored as one SHA-256 digest over the
token's digest, the method, the path and the key, so the table holds no token, key, path or user id.
**Verified by:** `apps/api/src/db/idempotency_store_tests.rs`; `idempotency_test.rs`
`the_same_key_with_another_token_is_a_new_request`, `a_keyed_request_without_a_token_is_not_recorded`.

### REQ-IDEM-006 [planned] The same key with a different request is refused

The fingerprint MUST be SHA-256 of the query string and the body bytes, never of headers: a new `traceparent` on a
retry is still the same request. A request whose scope has a record (pending or completed) with a different fingerprint
MUST answer `400 request.malformed` with the fixed message `This Idempotency-Key was used with another request`,
without running the handler and without changing the record.
**Verified by:** `idempotency_store_tests.rs`; `idempotency_test.rs` `reusing_a_key_for_another_request_is_refused`.

### REQ-IDEM-007 [planned] A success is stored and replayed

The first `2xx` answer to a keyed request MUST be stored: its status, its body and its `Content-Type`. While the record
is kept, a repeat with the same scope and fingerprint MUST get the same status and body plus `Idempotent-Replayed:
true`, and the handler MUST NOT run again.

The stored answer MUST NOT include `Set-Cookie` or any other header. Every other header of the replay comes from the
repeat itself, as for any request: its own `x-request-id` and `traceparent`, `Cache-Control: no-store`, the security
headers and the update nudge.
**Verified by:** `idempotency_test.rs` `a_repeated_deletion_replays_its_204_without_erasing_again` (a counting
`AccountEraser`).

### REQ-IDEM-008 [planned] Only a success is remembered

An answer that is not `2xx` MUST NOT be stored. This covers a validation failure, `401`, `403`, `5xx`, a store
`503` and a panic. The pending record is removed, so a repeat runs the handler again. A `keyed` handler MUST
therefore change nothing when it answers anything but `2xx`, as REQ-ACC-006 and REQ-DB-008 already require of
deletion.
**Verified by:** `idempotency_test.rs` `a_failed_deletion_is_not_remembered` (a failing eraser, then a working one,
same key: the second erases and answers `204`), `a_401_is_not_remembered`.

### REQ-IDEM-009 [planned] A replay outlives the token that earned it

The record MUST be looked up before the handler authenticates. A repeated deletion sent with the same access token and
key, after that deletion has revoked the token, MUST then get the stored `204` instead of `401`, so the device is
cleared (REQ-ACC-006). Without a record the request reaches the handler as usual.
**Verified by:** `idempotency_test.rs` `a_lost_deletion_answer_is_replayed_to_the_revoked_token`.

### REQ-IDEM-010 [planned] A duplicate in flight is turned away, and a pending record is never taken over

While the first request of a scope is pending, a repeat MUST answer `503 server.unavailable` with `Retry-After: 1` and
run nothing. When two first requests arrive at once, the primary key on the scope MUST decide which one runs: exactly
one (REQ-DB-007). A pending record is never taken over: if the server stops mid-request, the record stays pending
until it expires. The action happens at most once, never twice.
**Verified by:** `idempotency_store_tests.rs` `two_begins_at_once_start_exactly_one`; `idempotency_test.rs`
`a_repeat_during_the_first_answers_503_with_retry_after`.

### REQ-IDEM-011 [planned] A keyed request finishes even when its caller has gone

Once a keyed request has started, its handler MUST run to completion, and its outcome MUST be recorded (or the record
removed), even when the deadline has already answered `503` (REQ-ROB-004) or the client has disconnected. The request
id and span carry over.

- If storing a success fails, the caller still gets the success. A `warn` event `idempotency record not saved` is
  logged and the record stays pending until it expires.
- A panic in the handler MUST answer the `500` envelope (REQ-ROB-003) and remove the record.
  **Verified by:** `idempotency_test.rs` `a_deletion_past_the_deadline_is_replayed_afterwards` (a slow eraser, a short
  deadline), `a_panic_in_a_keyed_handler_answers_500_and_forgets_the_key`.

### REQ-IDEM-012 [planned] Records last one access-token lifetime and are pruned

A record MUST expire `IDEMPOTENCY_POLICY.retention_seconds` after the first request. Past that time it is treated as
absent. The hourly prune and `api prune` MUST delete expired records in batches of `DB_POLICY.prune_batch_rows` and
report their count as `idempotency` in `database pruned`.
**Verified by:** `idempotency_store_tests.rs`; `apps/api/tests/prune_test.rs`.

### REQ-IDEM-013 [planned] The table holds the least

`idempotency_keys` MUST hold only these columns:

- `scope` and `fingerprint` (SHA-256 digests);
- `status` (`NULL` while pending; a `CHECK` limits it to 200 to 299, so a constraint enforces REQ-IDEM-008);
- `content_type`;
- `body`;
- `expires_at`.

It holds no key, token, user id, path or header. It is created by a new forward-only migration and listed in
`docs/PERSISTENCE.md`.
**Verified by:** `pnpm migrations:check`; the schema snapshot; `idempotency_store_tests.rs`
`the_table_refuses_a_failure_status`.

### REQ-IDEM-014 [planned] Edge rules come first; browsers may send the key

The idempotency step MUST run inside the route, after CORS, load shedding, the rate limiter, the client's standing and
the auth `Origin` check. Consequences:

- A replay, a mismatch and an in-flight answer each count as one request of the route's class.
- A `429`, `426` or `403` never reads or writes a record.
- CORS MUST allow the `Idempotency-Key` request header.
  **Verified by:** `idempotency_test.rs` `replays_count_against_the_route_class`, `a_browser_may_send_the_key`.

### REQ-IDEM-015 [planned] The key is never logged or kept

The key MUST NOT appear in a log, a metric, an error message, a stored row or a response. The only new event is one
`debug` `idempotent request` with `outcome` (`replayed`, `in_flight` or `mismatch`). Clients never log it either
(REQ-SEC-014).
**Verified by:** `idempotency_test.rs` (captured logs never contain the key); `pnpm secrets:check`.

### REQ-IDEM-016 [planned] Clients mint one key per action and reuse it until it succeeds

These calls MUST send `Idempotency-Key` with a version-4 UUID from the platform:

- web: `SessionClient.deleteAccount` (`crypto.randomUUID()`);
- iOS: `TranSessionClient.deleteAccount` (`UUID()`);
- Android: `SessionClient.deleteAccount` (`UUID.randomUUID()`).

The key is minted when a deletion starts and none is pending. Every later attempt of the same deletion MUST reuse it,
both the repeat after a refresh (REQ-SEC-015) and the person's next tap after a failure, until a `2xx` arrives or the
session ends (sign-out, a new sign-in, a recovery sign-out). Then it is dropped. It is held in memory only: no client
has an outbox, so nothing is replayed across launches.

Clients send the key on `keyed` routes only. They still never retry a deletion automatically (REQ-RL-009,
REQ-ACC-006). They treat a replayed answer as the original and ignore `Idempotent-Replayed` (REQ-VER-008).
**Verified by:** `packages/api/tests/session-client.test.ts`, `SessionClientTests.swift`, `SessionClientTest.kt`.

## Out of scope (deliberately)

- An outbox that queues mutations offline and replays them after a relaunch. Adding one changes the scope to the
  user and the retention to hours (ADR-0052).
- Recording the answer in the same transaction as the handler's effect. That is the upgrade for a route that moves
  money (ADR-0052).
- Keys on sign-in and refresh. A lost refresh answer is the session rules' concern (REQ-SEC-016).
- Waiting for an in-flight original instead of answering `503`, and a metric for replays.
