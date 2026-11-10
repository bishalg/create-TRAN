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

## Sessions: `/api/auth/*`

Opaque rotating tokens ([spec 022](./specs/022-security.md), [ADR-0039](./adr/0039-sessions-tokens-and-secret-storage.md)).
The sample's sign-in has no credential check: choosing a role is the whole login; a fork verifies its credential in
front of `POST /api/auth/session`. Tokens are 32 random bytes, unpadded base64url; the access token lives 900 s, the
refresh token 30 days (`SESSION_POLICY` in `rust-core`). The server keeps only their SHA-256 digests.

The refresh token travels by one **transport**, chosen at sign-in and kept for the session's life: `cookie` (the web
app: an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`, never in a body) or `body` (native apps, which
keep it in the Keychain or Keystore). Every `/api/auth/*` answer carries `Cache-Control: no-store`. A request whose
`Origin` header is present and not in `CORS_ALLOWED_ORIGINS` answers `403 auth.forbidden` and changes nothing.

### `POST /api/auth/session` — sign in

```bash
curl -s -X POST http://127.0.0.1:3001/api/auth/session \
  -H 'Content-Type: application/json' \
  -d '{"role": "citizen_voter", "transport": "body"}'
```

`201`:

```json
{
  "access_token": "q3Jx…43 chars",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "Vb1n…43 chars",
  "user": { "user_id": "voter-001", "role": "citizen_voter" }
}
```

With `"transport": "cookie"` the body has no `refresh_token`; instead:

```http
Set-Cookie: tran_refresh=Vb1n…; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=2592000
```

`; Secure` is added whenever `APP_ENV` is not `development` or `test`. `role` is `citizen_voter` (user
`voter-001`) or `election_auditor` (user `auditor-001`); any other `role` or `transport` is `400 request.malformed`.

### `GET /api/auth/session` — who am I

```bash
curl -s http://127.0.0.1:3001/api/auth/session -H "Authorization: Bearer $ACCESS_TOKEN"
```

`200`: `{ "user_id": "voter-001", "role": "citizen_voter" }`. A missing header, another scheme, or a malformed,
unknown, revoked or expired token all answer the same `401 auth.session_expired` with `WWW-Authenticate: Bearer`.

### `POST /api/auth/refresh` — rotate the pair

```bash
# body transport
curl -s -X POST http://127.0.0.1:3001/api/auth/refresh \
  -H 'Content-Type: application/json' -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}"
# cookie transport (the browser sends the cookie itself)
curl -s -X POST http://127.0.0.1:3001/api/auth/refresh -H "Cookie: tran_refresh=$REFRESH_TOKEN"
```

`200` with the same shape as sign-in: a new access token, a new refresh token on the session's transport, and `user`.
The token presented is spent. A missing, unknown or expired refresh token answers `401 auth.session_expired` (and
clears the cookie, `Max-Age=0`, unless the token came in the body). Presenting a **spent** token again revokes the
whole session: every access and refresh token of it answers `401` from then on. Clients therefore share one in-flight
refresh, and decide what to do after a failure with `session_recovery` (`fixtures/session.json`).

### `POST /api/auth/sign-out` — revoke

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/api/auth/sign-out \
  -H 'Content-Type: application/json' -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}"
```

`204` always, with or without a known token, so it reveals nothing and is safe to repeat. The session is revoked and,
unless the token came in the body, the cookie is cleared.

## Account: `DELETE /api/account`

Deletes the caller's account for good ([spec 024](./specs/024-account-deletion.md),
[ADR-0041](./adr/0041-account-deletion.md)). Authenticated by the access token like any other call; it falls under the
same `Origin` check and `Cache-Control: no-store` as `/api/auth/*`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://127.0.0.1:3001/api/account \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

`204`, no body. The account's data is erased through the `AccountEraser` (`apps/api/src/account.rs`; the sample's
holds only sessions) and **every** session of that user is gone: on every device and either transport, each access and
refresh token issued before answers `401 auth.session_expired`. Other users are untouched. When the caller's session
uses the cookie transport, the answer also sends the header that clears the cookie:

```http
Set-Cookie: tran_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0
```

A browser ignores that header here: the request goes out without credentials (only `/api/auth/*` carries the cookie,
REQ-SEC-018). So the web client follows a successful deletion with the best-effort `POST /api/auth/sign-out`, which
carries the cookie and gets it removed; whether that call succeeds does not change the deletion, whose sessions are
already revoked.

A missing, unknown, revoked or expired access token answers `401 auth.session_expired` with `WWW-Authenticate: Bearer`
and erases nothing; so does a second delete with the same token. If the eraser fails (a fork's database), the answer is
`500 server.internal` and nothing was revoked, so the client keeps its session. A deletion logs one `info` event,
`account deleted`, carrying the request id and nothing about the user. The demo accounts are shared per role, so
deleting one signs out everyone using that role; signing in again creates it anew.

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
  is classified by status: `401` session expired, `403` forbidden, `409` conflict, `429` rate limited, `502`–`504`
  unavailable, other `4xx` malformed, other `5xx` internal.

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
| `auth.session_expired`            | 401  | no    | `info`  | dialog: Sign in again / Not now   |
| `auth.forbidden`                  | 403  | no    | `warn`  | error toast, 5 s                  |
| `request.conflict`                | 409  | no    | `info`  | warning toast, 5 s                |
| `server.rate_limited`             | 429  | yes   | `warn`  | warning toast, 5 s                |
| `server.internal`                 | 500  | yes   | `error` | error toast, 10 s, with reference |
| `server.unavailable`              | 503  | yes   | `warn`  | banner until a call succeeds      |
| `network.offline`                 | —    | yes   | `info`  | banner until a call succeeds      |
| `network.timeout`                 | —    | yes   | `info`  | banner until a call succeeds      |
| `client.unexpected`               | —    | no    | `error` | error toast, 10 s                 |
| `client.render_failed`            | —    | no    | `error` | full-page screen + Reload (web)   |

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
| The user must decide before going on | **dialog** — non-destructive        | session expired (`401`)       |
| The screen itself is broken          | **screen** — full page + Reload     | a render error (web only)     |

Choose the lowest presentation that lets the user act: silent < inline < toast < banner < dialog < screen
([ADR-0036](./adr/0036-crashes-auth-and-recovery-in-the-error-policy.md)).

Toasts never take focus, pause while hovered or focused, and can be dismissed. At most **3** are visible; the same
message and tone again restarts the visible toast instead of stacking a copy, and a fourth evicts the oldest
(REQ-ERR-012). Background calls the user did not start (the health check) are logged and may raise a banner, but
never toast.

### Recovery, crashes and reporting (REQ-ERR-011, REQ-ERR-013, REQ-ERR-014)

- **A banner recovers by itself.** While one is up, the app probes `/api/health` once (no retries) after 5 s, then
  10 s, 20 s, 40 s, capped at 60 s — and at once when the browser fires `online`, the tab becomes visible, the iOS app
  returns to the foreground / `NWPathMonitor` sees a network, or Android's default network returns. The first answer
  clears the banner. Web: `startRecovery` in `@tran/core`.
- **Crashes.** On the web one `CrashBoundary` turns a render error into `client.render_failed` (the `screen`
  presentation), and `window` `error` / `unhandledrejection` become `client.unexpected` toasts. iOS and Android report
  an uncaught exception, then let the previous handler end the process: a broken native view tree is not recoverable.
- **Reporting.** `error` means "a human must look": those failures, and only those, go to one reporter with exactly the
  `logEvent` fields (`setErrorReporter` on the web, `TranReporting.sink` on iOS and Android). The template installs
  none, so nothing leaves the device until you plug in Sentry, Crashlytics or your own endpoint. Only `client.*` codes
  carry the thrown value, for its stack.

### Retries (REQ-ERR-005)

Clients retry only **idempotent** requests that fail with a **retryable** code: at most **3 attempts**, waiting
`half + random × half` ms with `half = min(2000, 200 × 2^(retry−1)) / 2`, or the server's `Retry-After` seconds
(whole seconds only — `+1` or `1.5` are ignored — capped at 2 s); each attempt times out after 5 s. When the attempts are spent the app falls back — the eligibility
verdict comes from the device rules — so a flaky server never leaves the user at a dead end. A caller's cancellation
during a backoff wait ends the call at once as `request.cancelled` (pass `signal` to `withRetry`, REQ-ERR-015).

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

| Path                    | Rust module                      |
| :---------------------- | :------------------------------- |
| `/api/health`           | `apps/api/src/routes/health.rs`  |
| `/api/tran/info`        | `apps/api/src/routes/tran.rs`    |
| `/api/vote/eligibility` | `apps/api/src/routes/vote.rs`    |
| `/api/auth/*`           | `apps/api/src/routes/auth.rs`    |
| `/api/account`          | `apps/api/src/routes/account.rs` |

Router wiring: `apps/api/src/routes/mod.rs`.

Integration tests: `apps/api/tests/api_test.rs`, `apps/api/tests/auth_test.rs`, `apps/api/tests/account_test.rs`,
`apps/api/tests/security_headers_test.rs`.
