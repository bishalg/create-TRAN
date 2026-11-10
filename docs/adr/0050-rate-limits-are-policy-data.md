# ADR-0050 Rate limits are policy data, keyed by something the caller cannot forge

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [031](../specs/031-rate-limiting.md)

## Context

The API bounded the size and duration of one request (spec 012) and nothing else. Anyone could call sign-in, refresh
or account deletion as fast as the network allowed. The client address used for country lookup was the first hop of
`X-Forwarded-For`, a header any caller can write, so it could not be used to count anything. And an API that accepts
unlimited work fails all at once when it is overwhelmed.

The usual mistakes: a limit keyed on a forgeable header, so the attacker picks a new identity per request; a limit
only at the edge, so signed-in abuse is invisible; a limiter whose own map grows without bound and becomes the
outage; `429` without `Retry-After`, so well-behaved clients retry at once and make it worse; a different answer for
"limited" and "no such account", which leaks who exists; and a limiter outage that takes the whole API down with it.

## Decision

1. **Limits are data in Rust,** per class of route. Every route names its class in the route table, so adding a route
   forces the question. Configuration can change a class's numbers; code cannot special-case a route.
2. **A token bucket as a pure function,** with injected time and a fixture. It allows short bursts, which real apps
   produce at launch, and holds a steady rate after.
3. **The key is the user when there is one, else the client address read through trusted proxies only.** With no
   trusted proxy configured the peer address is used. This also fixes the forgeable address of REQ-API-004.
4. **Auth routes are limited before authentication** by address, and refresh also by session.
5. **One answer:** `429`, `rate.limited`, `Retry-After`, before any handler, identical whether or not the target
   exists.
6. **The limiter is bounded.** A fixed number of keys with eviction, behind a trait a fork points at a shared store.
7. **Shed load early.** Past a ceiling of in-flight requests the API answers `503` with `Retry-After` instead of
   queueing work it will time out on.
8. **Fail open, except for auth.** A broken limiter must not be an outage, but credential routes are never left
   unlimited.
9. **Clients obey.** They already honour `Retry-After` (ADR-0028); the catalogue gives `rate.limited` its own message
   and forbids automatic retry of something a person started.

## Consequences

- The sample's buckets are per process. Two API processes each allow the full rate; a fork running several needs a
  shared store (Redis or the database) behind the same trait.
- A limit by address punishes people behind one shared address (an office, a mobile carrier). The read and write
  limits are generous for that reason, and signed-in calls are counted by user instead.
- This is not bot protection, credential-stuffing detection or a web application firewall. Those belong in front of
  the API; the playbook says what to add.
- `TRUSTED_PROXIES` must be set correctly in production. Left empty behind a proxy, every caller shares the proxy's
  address and one bucket, which fails safe (too strict), not open.
