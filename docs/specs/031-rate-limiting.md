# 031 Rate limiting and abuse protection

Scope: how the Axum API (`apps/api`) limits how often one caller may use it, how it decides who a caller is, what it
answers when a limit is reached, how it sheds load when it is overwhelmed, and how the clients (`apps/web`, `apps/ios`,
`apps/android`) react. Builds on [002](002-http-api.md) (client IP, body and time limits), [011](011-error-feedback.md)
(`Retry-After`, retry policy), [022](022-security.md) (the auth routes) and [028](028-api-versioning.md) (route
table). Rationale: [ADR-0050](../adr/0050-rate-limits-are-policy-data.md). Playbook:
[`../RATE_LIMITING.md`](../RATE_LIMITING.md).

Vocabulary used below:

- A **class** is a group of routes with one limit: `auth` (sign-in, refresh, sign-out, account deletion), `write`
  (routes that change state), `read` (the rest, including `GET /api/v1/config` and any path no route answers), and
  `exempt` (the health and readiness probes under `/api/health`).
- A **key** is who the limit counts: the user for a signed-in call, otherwise the client address.
- A **token bucket** holds up to `burst` tokens and refills at a steady rate; a request takes one, and an empty bucket
  means "limited".

### REQ-RL-001 [verified] Limits are Rust data

`crates/rust-core/src/rate.rs` MUST define `RATE_POLICY`: for each class its sustained rate and burst (`auth` 10 per
minute, burst 5; `write` 60 per minute, burst 20; `read` 300 per minute, burst 60), and the route table MUST name the
class of every route, so a new route cannot be added without one. The numbers MUST be generated to TypeScript and be
overridable per class by configuration (`RATE_LIMIT_<CLASS>`), never per route in code. A rate or burst of `0` MUST
be unrepresentable in `ClassPolicy` and refused at start-up, naming the variable.
**Verified by:** `rate.rs` unit tests; a test that every route has a class; `config.rs` unit tests.

### REQ-RL-002 [verified] The limiter is one pure function

`take(bucket, policy, now)` MUST return whether the request is allowed, the new bucket state and, when limited, the
whole seconds until one token is available. It MUST be total: no input panics. Time MUST be injected. It is pinned by
`fixtures/rate.json`, including a burst, a steady drip, a long idle gap that refills no further than the burst and a
clock that goes backwards (treated as no time passing).
**Verified by:** `crates/rust-core/tests/rate_fixtures.rs`, `rate.rs` unit tests.

### REQ-RL-003 [verified] The key cannot be chosen by the caller

A signed-in request is counted by its user id, known without the session store from the access tokens this process
issued or authenticated; a bearer token it does not know is counted by address. Any other request is counted by
client address, resolved once per request from the socket peer and stored for the limiter and every handler. It MUST
be taken from `X-Forwarded-For` only when the direct peer is in `TRUSTED_PROXIES` (CIDR list; empty means trust nobody
and use the peer address): all header lines in order, walked from the right past trusted proxies to the first
address that is not one. If that hop, or any hop right of it, does not parse (an address, `ip:port`, `[ipv6]` or
`[ipv6]:port`), the header is ignored and the peer is used. No other header (`X-Real-IP`) is read. This replaces
"first hop of `X-Forwarded-For`, else `X-Real-IP`" in REQ-API-004, which a caller could forge.
**Verified by:** `apps/api/tests/rate_limit_test.rs` (`key_*`), `apps/api/tests/api_test.rs` (`eligibility_*`),
`geo.rs` unit tests.

### REQ-RL-004 [verified] A limited request gets one clear answer

A limited request MUST answer `429` with code `server.rate_limited` in the envelope and a `Retry-After` header in
whole seconds, before the store is asked and without touching the session or the database. The same answer MUST be
given whether or not the account or token named in the request exists.
**Verified by:** `rate_limit_test.rs` (`rate_limit_*`).

### REQ-RL-005 [verified] The auth routes are limited twice

Auth-class routes MUST be limited by client address before authentication and, for a refresh, also by the presented
refresh token (its digest), checked in the handler after the token is read and before the session store is asked, so
one stolen token cannot be hammered from many addresses. A failed refresh MUST cost the same token as a successful one.
**Verified by:** `rate_limit_test.rs` (`auth_*`).

### REQ-RL-006 [verified] The limiter's own memory is bounded

Buckets MUST live behind a `RateLimitStore` trait; the sample's store is in process memory with a fixed maximum number
of keys (`RATE_POLICY.max_keys`), evicting the bucket used least recently, so a flood of new keys cannot grow it
without limit; everything it keeps per key (the log stamp of REQ-RL-008 included) lives in that bound. A bucket idle
for a whole refill period (full again) MUST be dropped. Each request costs at most logarithmic work in the number of
keys.
**Verified by:** `rate_limit_test.rs` (`store_is_bounded*`), `rate_limit_store.rs` unit tests.

### REQ-RL-007 [verified] Overload is shed early

When more than `RATE_POLICY.max_in_flight` requests are being handled, further requests MUST answer `503`
`server.unavailable` with `Retry-After`, without queueing. Health routes are exempt so an orchestrator can still see
the process.
**Verified by:** `apps/api/tests/load_shed_test.rs`.

### REQ-RL-008 [verified] Limiting is visible to operators and silent about callers

Each class MUST count limited requests in a metric (`tran_rate_limited_total{class}`, spec 023) exported on the
metrics listener. A limited request MUST be logged at most once per key per window, with the class and no address,
user id or token.
**Verified by:** `rate_limit_test.rs` (log and metric assertions), `metrics_test.rs`.

### REQ-RL-009 [verified] Clients wait as told, and tell the person

On `server.rate_limited` a client MUST NOT retry before `Retry-After` has passed, MUST NOT retry a user-initiated
action automatically at all, and MUST present the catalogue's message for the code (`errors.rateLimited`: "Too many
requests. Please wait a moment and try again."), never a generic failure. A background call (token sync, configuration fetch) simply waits for its next
trigger.
**Verified by:** `fixtures/feedback.json` rows on every platform; the platform client tests.

### REQ-RL-010 [verified] A limiter failure does not take the API down

If the `RateLimitStore` fails, the request MUST be served and the failure logged once per window per process (fail
open), because an unavailable limiter must not become an outage. The auth class is the exception: it MUST answer
`503`, since unlimited credential attempts are worse than a short refusal. A panic in the limiter MUST answer the
`500` envelope of REQ-ROB-003, and the in-process store MUST keep working after one.
**Verified by:** `rate_limit_failure_test.rs` (`store_failure_*`, `a_panic_*`), `rate_limit_store.rs` unit tests.
