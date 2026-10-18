# TRAN API reference

The Axum app in `apps/api` exposes a small REST surface. JSON shapes match `@tran/api` Zod schemas so TypeScript clients can validate responses.

**Base URL (local):** `http://127.0.0.1:3001` (see `HOST` / `PORT` in `.env.example`)

---

## `GET /api/health`

Rust Core engine health report (uptime, component versions).

### Example

```bash
curl -s http://127.0.0.1:3001/api/health | jq
```

### Sample response

```json
{
  "overall_status": "HEALTHY",
  "uptime_seconds": 42,
  "components": [
    { "name": "rust-core", "version": "0.1.0", "healthy": true },
    { "name": "axum-api", "version": "0.1.0", "healthy": true }
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
    "T": "TanStack ecosystem (Vite + React SPA today; Start/router deps present but not wired — see docs/REVIEW.md)",
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

| Header                          | Purpose                                                              |
| :------------------------------ | :------------------------------------------------------------------- |
| `Content-Type`                  | `application/json`                                                   |
| `X-Forwarded-For` / `X-Real-IP` | Client IP for country stub                                           |
| `X-Debug-Country`               | **Development only** — force ISO country (`US`, `IN`, `NP`, `BR`, …) |

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

## Route modules

| Path                    | Rust module                     |
| :---------------------- | :------------------------------ |
| `/api/health`           | `apps/api/src/routes/health.rs` |
| `/api/tran/info`        | `apps/api/src/routes/tran.rs`   |
| `/api/vote/eligibility` | `apps/api/src/routes/vote.rs`   |

Router wiring: `apps/api/src/routes/mod.rs`.

Integration tests: `apps/api/tests/api_test.rs`.
