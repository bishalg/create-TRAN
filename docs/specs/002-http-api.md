# 002 HTTP API

Scope: the Axum service in `apps/api`. Request/response examples live in [`../API.md`](../API.md); this file is the
normative behaviour. Rationale: [ADR-0003](../adr/0003-uniform-error-envelope.md),
[ADR-0004](../adr/0004-inject-time-and-config.md), [ADR-0012](../adr/0012-browser-calls-api-directly.md).

### REQ-API-001 [verified] Handlers contain no business logic

Route handlers MUST only translate HTTP to a call on `rust_core::TranEngine` and back.
**Verified by:** HTTP tests assert results that only the engine can produce.

### REQ-API-002 [verified] Eligibility endpoint

`POST /api/vote/eligibility` with `{ "age": n, "birthdate"?: "YYYY-MM-DD" }` MUST return `200` with
`eligibility_id` (UUID), `eligible`, `age`, `minimum_age`, `country_code`, `country_source`, `client_ip`, `reason`,
`evaluated_at`, computed by the rules in spec 001.
**Verified by:** `apps/api/tests/api_test.rs` (`eligibility_*`).

### REQ-API-003 [verified] One error envelope

Every failure MUST be JSON `{ "success": false, "error": "<message>" }`: rule violations `400`; unreadable JSON,
missing or mistyped fields, negative age, impossible dates `400`; missing JSON content type `415`.
Unknown routes are `404` and wrong methods `405`.
**Verified by:** `api_test.rs` (`*_is_a_400_with_envelope`, `unknown_route_is_404`, `eligibility_rejects_get_with_405`).

### REQ-API-004 [verified] Client IP

The client IP MUST be the first hop of `X-Forwarded-For`, else `X-Real-IP`, else `127.0.0.1`.
**Verified by:** `api_test.rs` (`*x_forwarded_for*`, `*x_real_ip*`) and `geo.rs` unit tests.

### REQ-API-005 [verified] Country resolution order

The country MUST be resolved in this order: `X-Debug-Country` (when allowed by REQ-API-006), loopback address → `US`,
private ranges → `IN` (template stub), anything else → `US`. The response MUST report which rule applied in
`country_source`.
**Verified by:** `geo.rs` unit tests, `api_test.rs`.

### REQ-API-006 [planned] Debug country header is development-only

`X-Debug-Country` MUST be honoured only when `APP_ENV` is `development` or `test`. In any other environment it MUST be
ignored (not rejected) and the country resolved from the IP.
**Verified by:** `api_test.rs` with a production-configured app.

### REQ-API-007 [planned] CORS allowlist from configuration

Allowed origins MUST come from `CORS_ALLOWED_ORIGINS` (comma-separated). When unset, only the local development
origins are allowed and only when `APP_ENV` is `development` or `test`; in other environments no origin is allowed.
Preflight MUST permit `content-type`, `accept` and `x-debug-country`.
**Verified by:** `api_test.rs` (preflight tests), `config.rs` unit tests.

### REQ-API-008 [verified] Configuration from the environment

`HOST` (default `0.0.0.0`), `PORT` (default `3001`, invalid values fall back) and `APP_ENV` (default `development`)
MUST be read in one place and be injectable for tests.
**Verified by:** `config.rs` unit tests.

### REQ-API-009 [planned] List supported countries

`GET /api/vote/countries` MUST return `200` with `{ "countries": [{ "country_code", "minimum_age" }] }` sorted by code,
taken from REQ-RULE-009.
**Verified by:** `api_test.rs`.

### REQ-API-010 [planned] Single country

`GET /api/vote/countries/{code}` MUST return `200` `{ "country_code", "minimum_age" }` for a supported country
(case-insensitive), `400` for a malformed code, and `404` for a well-formed code that is not supported. (The eligibility
endpoint still falls back to 18 for unsupported codes, REQ-RULE-002; pages need a real "not found".)
**Verified by:** `api_test.rs`.

### REQ-API-011 [planned] Contract snapshots

Real responses of the router MUST be validated against the TypeScript Zod schemas. A Rust test writes normalised
response snapshots to `fixtures/contract/`; CI fails if regenerating them changes anything; a TypeScript test parses
every snapshot with the schemas.
**Verified by:** `apps/api/tests/contract_test.rs`, `packages/api/tests/contract-snapshots.test.ts`.

### REQ-API-012 [planned] Health reports only what the server can observe

`GET /api/health` MUST list only components the server can observe (`rust-core`, `axum-api`), each with its real crate
version, and MUST NOT report the state of clients.
**Verified by:** `api_test.rs` (`health_*`).

### REQ-API-013 [verified] Server serves over a real socket

`run_server` MUST bind the configured address and serve the router; an unbindable address MUST return an error.
**Verified by:** `apps/api/tests/server_test.rs`.
