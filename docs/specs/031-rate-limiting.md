# 031 Rate limiting and abuse protection

Scope: how the Axum API (`apps/api`) limits how often one caller may use it, how it decides who a caller is, what it
answers when a limit is reached, how it sheds load when it is overwhelmed, and how the clients (`apps/web`, `apps/ios`,
`apps/android`) react. Builds on [002](002-http-api.md) (client IP, body and time limits), [011](011-error-feedback.md)
(`Retry-After`, retry policy), [022](022-security.md) (the auth routes) and [028](028-api-versioning.md) (route
table). Rationale: [ADR-0050](../adr/0050-rate-limits-are-policy-data.md). Playbook:
[`../RATE_LIMITING.md`](../RATE_LIMITING.md).

Vocabulary used below:

- A **class** is a group of routes with one limit: `auth` (sign-in, refresh, sign-out, account deletion), `write`
  (routes that change state), `read` (the rest), and `exempt` (health, configuration).
- A **key** is who the limit counts: the user for a signed-in call, otherwise the client address.
- A **token bucket** holds up to `burst` tokens and refills at a steady rate; a request takes one, and an empty bucket
  means "limited".

### REQ-RL-001 [verified] Limits are Rust data

`crates/rust-core/src/rate.rs` MUST define `RATE_POLICY`: for each class its sustained rate and burst (`auth` 10 per
minute, burst 5; `write` 60 per minute, burst 20; `read` 300 per minute, burst 60), and the route table MUST name the
class of every route, so a new route cannot be added without one. The numbers MUST be generated to TypeScript and be
overridable per class by configuration (`RATE_LIMIT_<CLASS>`), never per route in code.
**Verified by:** `rate.rs` unit tests; a test that every route has a class.

### REQ-RL-002 [verified] The limiter is one pure function

`take(bucket, policy, now)` MUST return whether the request is allowed, the new bucket state and, when limited, the
whole seconds until one token is available. Time MUST be injected. It is pinned by `fixtures/rate.json`, including a
burst, a steady drip, a long idle gap and a clock that goes backwards (treated as no time passing).
**Verified by:** `crates/rust-core/tests/rate_fixtures.rs`.

### REQ-RL-003 [verified] The key cannot be chosen by the caller

A signed-in request is counted by its user id. Any other request is counted by client address, which MUST be taken
from `X-Forwarded-For` only when the direct peer is in `TRUSTED_PROXIES` (CIDR list; empty means trust nobody and use
the peer address), reading the right-most address that is not itself a trusted proxy. This replaces "first hop of
`X-Forwarded-For`" in REQ-API-004, which a caller could forge. An unparsable header is ignored.
**Verified by:** `apps/api/tests/rate_limit_test.rs` (`key_*`), `geo.rs` unit tests.

### REQ-RL-004 [verified] A limited request gets one clear answer

A limited request MUST answer `429` with code `rate.limited` in the envelope and a `Retry-After` header in whole
seconds, before any handler runs and without touching the session or the database. The same answer MUST be given
whether or not the account or token named in the request exists.
**Verified by:** `rate_limit_test.rs`.

### REQ-RL-005 [verified] The auth routes are limited twice

Auth-class routes MUST be limited by client address before authentication and, for a refresh, also by the session the
presented token belongs to, so one stolen token cannot be hammered from many addresses. A failed refresh MUST cost the
same token as a successful one.
**Verified by:** `rate_limit_test.rs` (`auth_*`).

### REQ-RL-006 [verified] The limiter's own memory is bounded

Buckets MUST live behind a `RateLimitStore` trait; the sample's store is in process memory with a fixed maximum number
of keys (`RATE_POLICY.max_keys`), evicting the buckets idle longest, so a flood of new keys cannot grow it without
limit. A full bucket that has been idle for a whole refill period MUST be dropped.
**Verified by:** `rate_limit_test.rs` (`store_is_bounded`).

### REQ-RL-007 [verified] Overload is shed early

When more than `RATE_POLICY.max_in_flight` requests are being handled, further requests MUST answer `503`
`server.unavailable` with `Retry-After`, without queueing. Health routes are exempt so an orchestrator can still see
the process.
**Verified by:** `apps/api/tests/load_shed_test.rs`.

### REQ-RL-008 [verified] Limiting is visible to operators and silent about callers

Each class MUST count limited requests in a metric (`tran_rate_limited_total{class}`, spec 023). A limited request MUST
be logged at most once per key per window, with the class and no address, user id or token.
**Verified by:** `rate_limit_test.rs` (log and metric assertions).

### REQ-RL-009 [verified] Clients wait as told, and tell the person

On `rate.limited` a client MUST NOT retry before `Retry-After` has passed, MUST NOT retry a user-initiated action
automatically at all, and MUST present the catalogue's message for the code ("Too many attempts. Try again in a
moment."), never a generic failure. A background call (token sync, configuration fetch) simply waits for its next
trigger.
**Verified by:** `fixtures/feedback.json` rows on every platform; the platform client tests.

### REQ-RL-010 [verified] A limiter failure does not take the API down

If the `RateLimitStore` fails, the request MUST be served and the failure logged once per window (fail open), because
an unavailable limiter must not become an outage. The auth class is the exception: it MUST answer `503`, since
unlimited credential attempts are worse than a short refusal.
**Verified by:** `rate_limit_test.rs` (`store_failure_*`).
