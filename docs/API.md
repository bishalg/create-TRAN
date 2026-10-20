# TRAN API reference

The Axum app in `apps/api` exposes a small REST surface. JSON shapes match `@tran/api` Zod schemas so TypeScript clients can validate responses.

**Base URL (local):** `http://127.0.0.1:3001` (see `HOST` / `PORT` in `.env.example`)

---

## `GET /api/health`

Reports only what the server can observe in-process (REQ-API-012): `rust-core` and `axum-api`, each with its real
crate version.

### Example

```bash
curl -s http://127.0.0.1:3001/api/health | jq
```

### Sample response

```json
{
  "report_id": "1f0c…",
  "timestamp": "2026-10-20T08:00:00Z",
  "overall_status": "HEALTHY",
  "components": [
    {
      "layer": "rustcore",
      "name": "rust-core",
      "version": "0.1.0",
      "healthy": true,
      "uptime_seconds": 42
    },
    {
      "layer": "axumapi",
      "name": "axum-api",
      "version": "0.1.0",
      "healthy": true,
      "uptime_seconds": 42
    }
  ]
}
```

---

## `GET /api/tran/info`

Stack metadata for the template demo (not a compute endpoint).

### Example

```bash
curl -s http://127.0.0.1:3001/api/tran/info | jq
```

### Sample response

```json
{
  "stack": "TRAN",
  "description": "Voting Eligibility demo — TanStack + Rust Core + Axum + Native",
  "demo": "voting-eligibility",
  "layers": {
    "T": "Vite + React SPA today; TanStack Start SSR is planned (ADR-0010, REQ-SEO)",
    "R": "Rust Core (Shared logic, Domain, Validation, Algorithms)",
    "A": "Axum (High-performance Async Web Backend)",
    "N": "Native mobile — SwiftUI (iOS) and Jetpack Compose (Android); apps/ios + apps/android"
  },
  "version": "0.1.0"
}
```

---

## `POST /api/vote/eligibility`

Evaluates voting eligibility using **Rust Core** (`crates/rust-core/src/voting.rs`). Country is resolved from the client IP via a **stub geo resolver** (not production geolocation).

### Headers

| Header                          | Purpose                                                                                  |
| :------------------------------ | :--------------------------------------------------------------------------------------- |
| `Content-Type`                  | `application/json`                                                                       |
| `X-Forwarded-For` / `X-Real-IP` | Client IP for country stub                                                               |
| `X-Debug-Country`               | Honoured only when `APP_ENV` is `development` or `test`; ignored otherwise (REQ-API-006) |

Loopback addresses default to `US`; private ranges stub to `IN` for demo variety.

### Request body

```json
{ "age": 20 }
```

Optional: `"birthdate": "2004-06-15"` (ISO date; age derived when provided).

### Example — eligible (US, age 21)

```bash
curl -s -X POST http://127.0.0.1:3001/api/vote/eligibility \
  -H 'Content-Type: application/json' \
  -H 'X-Debug-Country: US' \
  -d '{"age": 21}' | jq
```

### Sample response

```json
{
  "eligibility_id": "550e8400-e29b-41d4-a716-446655440000",
  "eligible": true,
  "reason": "Meets minimum voting age for US (18).",
  "minimum_age": 18,
  "country_code": "US",
  "country_source": "debug-header",
  "client_ip": "127.0.0.1",
  "evaluated_at": "2026-01-15T12:00:00Z"
}
```

### Example — not eligible (India, age 16)

```bash
curl -s -X POST http://127.0.0.1:3001/api/vote/eligibility \
  -H 'Content-Type: application/json' \
  -H 'X-Debug-Country: IN' \
  -d '{"age": 16}' | jq
```

### Sample response

```json
{
  "eligible": false,
  "reason": "Must be at least 18 to vote in IN.",
  "minimum_age": 18,
  "country_code": "IN"
}
```

### TypeScript client

```ts
import { TranApiClient } from '@tran/core';

const client = new TranApiClient({
  baseUrl: 'http://127.0.0.1:3001',
  headers: { 'X-Debug-Country': 'NP' },
});

const result = await client.checkVoteEligibility({ age: 20 });
// Zod-validated VoteEligibilityOutput
```

---

## Errors

Every failure — from any route, an unknown route (`404`) or a wrong method (`405`) — has one shape
(REQ-ERR-002):

```json
{
  "success": false,
  "error": "Country code must be two ASCII letters (ISO 3166-1 alpha-2)",
  "code": "validation.invalid_country_code",
  "retryable": false,
  "request_id": "6f1c2a9e-…"
}
```

- **`code`** is the contract. It is stable, dotted and snake_case; clients branch on it and show the localized
  message for it. **`error` is for developers only** — never show it to a user (REQ-ERR-009). A `5xx` always says
  `Internal server error`; the cause is in the server log under the same `request_id` (REQ-ERR-003).
- **`x-request-id`** is on every response and equals `request_id`. Send your own (1–64 of `A–Z a–z 0–9 . _ -`) to
  correlate logs across services; anything else is replaced. Clients apply the same rule to the id they read back and
  drop one that does not match, because they log it and show it (REQ-ROB-010).
- **`retryable`** says whether an idempotent request may be retried. A body without `code` (a proxy, an old server)
  is classified by status: `429` rate limited, `502`–`504` unavailable, other `4xx` malformed, other `5xx` internal.

The catalogue lives in [`crates/rust-core/src/feedback.rs`](../crates/rust-core/src/feedback.rs) and is pinned by
[`fixtures/feedback.json`](../fixtures/feedback.json); TypeScript, Swift and Kotlin read generated copies
([ADR-0028](./adr/0028-error-feedback-policy-in-rust.md)).

| Code                              | HTTP | Retry | Log     | The user sees                     |
| :-------------------------------- | :--- | :---- | :------ | :-------------------------------- |
| `validation.age_out_of_range`     | 400  | no    | `debug` | inline, next to the field         |
| `validation.birthdate_in_future`  | 400  | no    | `debug` | inline                            |
| `validation.invalid_country_code` | 400  | no    | `debug` | inline                            |
| `validation.invalid_date`         | 400  | no    | `debug` | inline                            |
| `request.malformed`               | 400  | no    | `warn`  | error toast, 5 s                  |
| `request.unsupported_media_type`  | 415  | no    | `warn`  | error toast, 5 s                  |
| `request.too_large`               | 413  | no    | `warn`  | error toast, 5 s                  |
| `request.cancelled`               | —    | no    | `debug` | nothing (silent)                  |
| `route.not_found`                 | 404  | no    | `warn`  | error toast, 5 s                  |
| `route.method_not_allowed`        | 405  | no    | `warn`  | error toast, 5 s                  |
| `server.rate_limited`             | 429  | yes   | `warn`  | warning toast, 5 s                |
| `server.internal`                 | 500  | yes   | `error` | error toast, 10 s, with reference |
| `server.unavailable`              | 503  | yes   | `warn`  | banner until a call succeeds      |
| `network.offline`                 | —    | yes   | `info`  | banner until a call succeeds      |
| `network.timeout`                 | —    | yes   | `info`  | banner until a call succeeds      |
| `client.unexpected`               | —    | no    | `error` | error toast, 10 s                 |

`—` means the client observes it without an HTTP answer.

### Limits and hostile input (REQ-ROB-003, REQ-ROB-004)

Every row of [`fixtures/failure-modes.json`](../fixtures/failure-modes.json) is a request the API must reject — or an
answer every client must classify — and each platform's suite runs all of them.

- **Body size:** more than 16 KiB answers `413 request.too_large`.
- **Deadline:** a handler that runs longer than 4 s (`SERVER_DEADLINE_MS`) answers `503 server.unavailable`. That is
  below the client's 5 s per-attempt timeout, so a client always gets an envelope rather than a timeout.
- **Panics** answer `500 server.internal` with the envelope; the panic message and location go to the log under the
  `request_id`, never to the response.
- **Body rejections** use fixed messages (`The body does not match the expected shape (see docs/API.md)`, `The body is
not valid JSON`, …) so a payload never echoes back. The body must be a JSON object: `[20]` is rejected, not read as
  `{ "age": 20 }`. Dates are exactly `YYYY-MM-DD`; `+002000-01-01`, ` 2000-01-01` and `2000-1-01` are rejected.

### Logs (REQ-ROB-007)

One failure, one event: `request failed` with `code`, `status`, `request_id` (the fields in `fixtures/feedback.json`
`logEvent`) plus a developer `detail`, at the catalogue's level. Every completed request also logs one `debug`
`request completed` with `status` and `latency_ms`. Request payloads are never logged.

| `APP_ENV`     | Format               | Default filter |
| :------------ | :------------------- | :------------- |
| `development` | human-readable       | `api=debug`    |
| anything else | one JSON object/line | `api=info`     |

`RUST_LOG` overrides the filter. To follow one request: `grep '"request_id":"<id>"'` on the JSON output.

### Which presentation, when (REQ-ERR-006)

| Situation                            | Presentation                        | Example                       |
| :----------------------------------- | :---------------------------------- | :---------------------------- |
| Nothing the user can act on          | **silent** — log only               | the screen closed mid-request |
| The user's input is wrong            | **inline** — next to the field      | country `U1`                  |
| Something finished                   | **success toast**, short (3 s)      | server check complete         |
| A one-off problem worth reading      | **toast**, medium (5 s)             | rate limited                  |
| A failure someone may need to report | **error toast**, long (10 s) + ref. | `500`, with `request_id`      |
| A condition that is still true       | **banner** — until it clears        | the API is unreachable        |
| An action that destroys state        | **dialog** — Cancel is the default  | sign out                      |

Toasts never take focus, pause while hovered or focused, and can be dismissed. Background calls the user did not
start (the health check) are logged and may raise a banner, but never toast.

### Retries (REQ-ERR-005)

Clients retry only **idempotent** requests that fail with a **retryable** code: at most **3 attempts**, waiting
`half + random × half` ms with `half = min(2000, 200 × 2^(retry−1)) / 2`, or the server's `Retry-After` seconds
(whole seconds only — `+1` or `1.5` are ignored — capped at 2 s); each attempt times out after 5 s. When the attempts are spent the app falls back — the eligibility
verdict comes from the device rules — so a flaky server never leaves the user at a dead end.

```ts
import { classifyError, withRetry } from '@tran/core';

try {
  const result = await withRetry(() => client.checkVoteEligibility({ age: 20 }), {
    idempotent: true,
  });
} catch (err) {
  const failure = classifyError(err); // failure.code, failure.spec.presentation, failure.requestId
}
```

---

## Route modules

| Path                    | Rust module                     |
| :---------------------- | :------------------------------ |
| `/api/health`           | `apps/api/src/routes/health.rs` |
| `/api/tran/info`        | `apps/api/src/routes/tran.rs`   |
| `/api/vote/eligibility` | `apps/api/src/routes/vote.rs`   |

Router wiring: `apps/api/src/routes/mod.rs`.

Integration tests: `apps/api/tests/api_test.rs`.
