# 012 Failure modes and robustness

Scope: failures nobody writes an example for — hostile or nonsensical input, panics, slow handlers, cancelled and
overlapping requests, and the logs they leave behind — across `crates/rust-core`, `apps/api`, `packages/*` and the web,
iOS and Android clients. Rationale: [ADR-0029](../adr/0029-failure-modes-and-mutation-gate.md). Golden cases:
`fixtures/failure-modes.json`. Builds on [011](011-error-feedback.md).

### REQ-ROB-001 [verified] A derived age obeys the same limits as a given one

When a birthdate is supplied, the age derived from it MUST be validated against `MAX_AGE` exactly like a supplied age
(`validation.age_out_of_range`). Deriving an age MUST NOT wrap or truncate: a birthdate thousands of years ago is out of
range, never a small number. Rust, TypeScript and UniFFI MUST agree (`fixtures/vote-eligibility.json`).

### REQ-ROB-002 [verified] Only transport failures are network failures

`network.offline` and `network.timeout` MUST only come from the transport (fetch, `URLSession`, OkHttp) failing to get
an answer. A programming error in client code MUST classify as `client.unexpected` and log at `error`, never as
offline. On iOS only connectivity `URLError` codes are `network.offline`; a malformed URL is a client bug.

### REQ-ROB-003 [verified] A panic answers with the envelope

A panic while handling a request MUST answer `500` with the REQ-ERR-002 envelope (`server.internal`, the request id,
the generic message) and MUST log exactly one `error` event carrying the request id and the panic message. A panic
outside a request MUST be logged through `tracing`, not printed.

### REQ-ROB-004 [verified] Slow handlers and oversized bodies answer with catalogue codes

A request that runs longer than the server deadline MUST answer `503` `server.unavailable` with the envelope; the server
deadline MUST be shorter than the client's per-attempt timeout so a client always receives an envelope. A body larger
than the server limit MUST answer `413` `request.too_large`.

### REQ-ROB-005 [verified] Error handling never fails

Classifying a failure MUST be total: `classifyError` returns a `TranRequestError` for every value, including objects
without a prototype, throwing getters and revoked proxies. Constructing a failure with a code this build does not know
MUST fall back to `client.unexpected` rather than throw.

### REQ-ROB-006 [verified] Callers can cancel, and only the newest answer counts

Every client call MUST accept a caller's cancellation and report it as `request.cancelled` (silent, never retried).
Starting a new eligibility check MUST cancel the one in flight, and an answer for a superseded or unmounted check MUST
NOT change the screen.

### REQ-ROB-007 [verified] One structured log event per failure, without the payload

Each failure MUST produce exactly one log event, `request failed`, with the fields in `fixtures/feedback.json`
`logEvent` (`code`, `status`, `request_id`) on every platform. Request payloads (ages, birthdates, headers' values) MUST
NOT appear in a log or in the developer `error` message: body rejections answer with fixed messages. Each completed
request MUST log one `debug` event with its status and latency. The API MUST log JSON outside `development`.

### REQ-ROB-008 [verified] Ad-hoc logging and unchecked unwraps fail the build

Outside tests and the codegen CLI, Rust MUST NOT use `println!`, `eprintln!`, `dbg!`, `unwrap()` or unexplained
`expect()`; TypeScript MUST NOT call `console` except through `logFailure`; Swift and Kotlin MUST NOT call `print`,
`NSLog`, `println` or `android.util.Log` except in their one feedback logger.

### REQ-ROB-009 [verified] Rules hold for every input, not just the examples

Property tests MUST show, for generated input: a derived age is never above `MAX_AGE` without being rejected and never
negative; age is monotone in the reference date; country-code validation accepts exactly two ASCII letters; every retry
delay lies in `[half, 2 × half]` and never exceeds the policy maximum; `Retry-After` is honoured only when it is
whole seconds (`1*DIGIT`, RFC 9110 — not `+1`, `1.5` or `-1`) and never exceeds the maximum, even past `u64`.

### REQ-ROB-010 [verified] Failure modes are one shared table

`fixtures/failure-modes.json` MUST list the HTTP requests the API must reject and the HTTP answers clients must
classify. The API, the TypeScript client and the Swift and Kotlin clients MUST each pass every row.

Clients MUST read an error body the same way: it is an envelope only when it is a JSON object with `success: false`,
a string `error`, and — when present — a string `code`, a boolean `retryable` and a string `request_id`; any other
body is ignored as a whole and the HTTP status decides. A request id (from the body or the `x-request-id` header) MUST
match the server's shape — 1 to 64 characters of `[A-Za-z0-9._-]` — or be dropped, because clients log it and show it
to users.

### REQ-ROB-011 [verified] An evaluation reads the clock once

The deterministic core MUST take the evaluation instant as input; `evaluated_at` and the date used for age MUST come
from the same instant, so an evaluation straddling midnight cannot mix two days.

### REQ-ROB-012 [verified] Robustness is measured by mutation, nightly

`cargo-mutants` (rust-core, api, tran-tokens-codegen) and Stryker (`packages/core-ts`) MUST run on a nightly schedule and on manual dispatch
(`.github/workflows/mutation.yml`), never on pull requests, with every action pinned by commit SHA and every job given a
timeout. Stryker MUST fail below its `break` threshold; cargo-mutants MUST fail on any missed mutant that is not listed,
with a reason, in `.cargo/mutants.toml`. Thresholds may rise, never fall.
