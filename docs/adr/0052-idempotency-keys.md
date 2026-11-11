# ADR-0052 Repeats are made safe per route; one route takes an idempotency key, scoped to its access token

**Status:** proposed · **Date:** 2026-11-11 · **Spec:** [033](../specs/033-idempotency.md)

## Context

Clients repeat requests. They retry retryable failures (REQ-ERR-005), repeat a call after refreshing a token
(REQ-SEC-015), and people tap again after an error. A request can also succeed on the server while its answer is
lost. The 4 s deadline answers `503`, but work already on the blocking pool keeps running and may commit. And a
client can time out after the server has finished.

Going through the route table, most routes are already safe to repeat:

- `POST /vote/eligibility` computes and changes nothing.
- `PUT /devices/{installation_id}` replaces a resource named by an id the client generated.
- `DELETE /devices/{installation_id}` and `POST /auth/sign-out` answer `204` either way.

Two routes answer with a credential (`POST /auth/session`, `POST /auth/refresh`). Their answers cannot be stored,
because the server keeps only digests (REQ-SEC-006), and refresh's replay detection is a security feature.

`DELETE /api/v1/account` is the exception. Its effect happens only once, but its answer changes: the first answer is
`204`, every later one `401`, because the deletion revoked the token. The device clears itself only on `204`
(REQ-ACC-006). So a lost `204` leaves the account deleted while the device still looks signed in, until a misleading
"session expired" dialog appears. Every client works around this with single flight and a comment.

The template had nothing to teach for this case, and the coming phases (purchases, ROADMAP §6.13) bring routes where
running twice costs money.

## Decision

1. **Every route names its repeat rule** in the route table, next to its rate class: `natural`, `keyed` or `never`.
   Adding a route forces the question.
2. **The `Idempotency-Key` request header** (IETF httpapi draft name) carries a version-4 UUID. It is optional, so the
   change is additive inside `/api/v1`. It is ignored on routes that are not keyed. The sample keys
   `DELETE /api/v1/account` only.
3. **A record is scoped to the access token** that made the request, plus method, path and key, all hashed into one
   digest. It is looked up **before authentication**, so a deletion's `204` is replayed to the token the deletion
   revoked. The record lives exactly one access-token lifetime (900 s), which is the longest any retry can happen
   today, because no client has an outbox.
4. **Only a `2xx` is stored** (status, body, `Content-Type`; never `Set-Cookie`). Any other answer removes the
   pending record, because a keyed handler changes nothing when it fails. A database `CHECK` enforces this.
5. **A different body under the same key is `400 request.malformed`. A duplicate in flight is `503
server.unavailable` with `Retry-After: 1`.** Both are existing catalogue codes, so no client needs a new message.
6. **A keyed request runs to completion in its own task**, so a deadline or a disconnect cannot separate the effect
   from its record. A pending record is never taken over: after a crash the action has happened at most once.
7. **The record lives in the one SQL store**, behind an `IdempotencyStore` trait like the others. It is pruned by the
   existing prune, and its scope and fingerprint are stored as digests.

## Alternatives rejected

- **Natural keys only** (a unique constraint on the business identity). We already use them where a resource has an
  identity: one registration per push token (REQ-PSH-002). They make the _effect_ happen once but not the _answer_: a
  repeated account deletion is harmless to the data, yet still answers `401`. Account deletion has no business
  identity to put a constraint on anyway.
- **Client-generated resource ids** (`PUT /things/{uuid}`). The device registry already works this way. But account
  deletion names no resource, and moving an existing route to a new path or method is a change, not an addition,
  inside `/api/v1` (ADR-0047). It also fixes only creation, not actions.
- **PUT semantics / "DELETE is idempotent by HTTP".** HTTP idempotency is about effect, not answer. The method already
  is DELETE, and the problem remains.
- **Deduplicating every mutation by a hash of its body, without a key.** This merges two deliberate identical actions,
  and the server cannot tell a retry from a second intent; only the client knows.
- **User-scoped keys kept for 24 hours** (Stripe's model). That is the right model once an outbox replays hours later
  across token refreshes. Here the user's sessions are gone after a deletion, so the lookup would need an
  authentication that can no longer succeed. It would also store a user id that account deletion must then erase. Any
  repeat that happens today happens within one access token's life.
- **Recording the answer in the handler's own transaction.** This closes the crash window, but it means threading a
  transaction through `SessionStore`, `DeviceStore` and the `AccountEraser` seam. The sample instead runs keyed
  requests in their own task and never takes over a pending record (at most once). This is the documented upgrade
  for a route that moves money.
- **`409` for a duplicate in flight and `422` for a mismatch** (the draft's suggestion). The catalogue's `409` is not
  retryable, and it has no `422`. A new code means locale strings and catalogue changes on every platform for a state
  that our clients, which run single flight, rarely see. `503` with `Retry-After` is retryable and already presented.
- **A third-party idempotency service, or Redis.** This would break the one-SQL-store and no-third-party-SDK rules
  (ADR-0049, AGENTS.md).

## Consequences

- An old client sends no key and is served as before. The released-client replay proves it.
- The guarantee lasts one access-token lifetime and is tied to one token. A fork that adds an outbox must switch the
  scope to the user, lengthen retention, add a `user_id` column that `AccountEraser` deletes, and persist the key with
  the queued request. The playbook lists these steps.
- A keyed handler must change nothing on failure. That is a rule for reviewers, stated in the playbook, and partly
  enforced by the `CHECK (status BETWEEN 200 AND 299)` constraint.
- A keyed request costs two extra short write transactions on the single connection.
- The sample's in-flight answer is `503` rather than the draft's `409`. Changing it later inside v1 would change
  behaviour, so it is settled here.
