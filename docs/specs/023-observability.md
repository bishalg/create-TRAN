# 023 Observability: logs, traces, metrics and lifecycle

Scope: how one user action can be followed from a client through the Axum API (`apps/api`) and back; what the API
logs for every request and counts for every route; how an orchestrator learns the process is alive, ready or
leaving; and what the web app (`apps/web`), iOS (`apps/ios`) and Android (`apps/android`) add to each call and each
failure event. Builds on [011](011-error-feedback.md) (request id, the reporter), [012](012-failure-modes.md) (one
failure event, no payload, no ad-hoc logging) and [022](022-security.md) (nothing sensitive is printed). Rationale:
[ADR-0040](../adr/0040-observability-open-formats-no-vendor.md). Runbook: [`../OBSERVABILITY.md`](../OBSERVABILITY.md).

Vocabulary used below:

- A **trace** is one user action across every process it touches, named by a 32-hex-digit **trace id**. A **span** is
  one process's part of it, named by a 16-hex-digit **span id**. Both travel in the W3C `traceparent` header:
  `00-<trace id>-<span id>-<flags>`.
- The **request id** (REQ-ERR-002) names one HTTP exchange and is the reference a user can read out. The trace id
  joins exchanges that belong together (a call and its retries, a refresh and the call it rescued).
- A **route** is the matched route template (`/api/v1/vote/countries/{code}`), never the raw path, so a label or a log
  field has a bounded set of values and carries no user input.
- **RED** metrics are the rate, errors and duration of requests.

## One vocabulary

### REQ-OBS-001 [verified] Trace context is one Rust module

`crates/rust-core/src/trace.rs` MUST define `parse_traceparent` (accepts only version `00`, lowercase hex, a trace id
and a span id that are not all zeros; anything else is `None`), `format_traceparent`, `new_trace` and `child_span`
(same trace id, new span id). Randomness MUST be injected so the functions are pure. All four MUST be exported over
UniFFI and mirrored in TypeScript, pinned by `fixtures/trace.json`.
**Verified by:** `crates/rust-core/tests/trace_fixtures.rs`, `crates/tran-uniffi/tests/trace_fixtures.rs`,
`packages/core-ts/tests/trace.test.ts`, `TraceParityTests.swift`, `TraceParityTest.kt`.

### REQ-OBS-002 [verified] The log schema is Rust data

`crates/rust-core` MUST define every structured event a platform may emit and its allowed fields: `request failed`
(`code`, `status`, `request_id`, `trace_id`) and `request completed` (`method`, `route`, `status`, `latency_ms`,
`request_id`, `trace_id`). The schema MUST reach TypeScript through `pnpm tokens:sync` and native code through UniFFI,
and `fixtures/feedback.json` `logEvent` MUST list the same fields. A field outside the schema MUST fail a test on the
platform that added it.
**Verified by:** `feedback.rs` unit tests, the `logEvent` fixture rows on every platform.

## The API

### REQ-OBS-003 [verified] The API continues a trace or starts one

A request with a valid `traceparent` MUST be handled in a span with the same trace id and a new span id; a missing or
invalid header MUST start a new trace. Every log event written while handling the request MUST carry `trace_id` and
`request_id`. Preflight MUST permit the `traceparent` header (REQ-API-007).
**Verified by:** `apps/api/tests/trace_test.rs`.

### REQ-OBS-004 [verified] One access-log event per request

Each completed request MUST log exactly one `request completed` event with the fields of REQ-OBS-002, where `route` is
the matched template or `unmatched`. The level MUST be `info`, except for the health and readiness probes, which log at
`debug` so they do not drown the rest. The raw path, the query string and header values MUST NOT be logged. (This
replaces the `debug` level stated in REQ-ROB-007.)
**Verified by:** `apps/api/tests/access_log_test.rs`.

### REQ-OBS-005 [verified] RED metrics with bounded labels

The API MUST count `tran_http_requests_total{method,route,status}`, observe
`tran_http_request_duration_seconds{method,route}` in a histogram with fixed buckets from 5 ms to 10 s, track
`tran_http_requests_in_flight`, and expose `tran_build_info{version}` as `1`. `route` MUST be the matched template or
`unmatched`; `method` MUST be one of the standard methods or `OTHER`. No label may hold a path, an id or any other
client-chosen value.
**Verified by:** `apps/api/tests/metrics_test.rs`.

### REQ-OBS-006 [verified] Metrics are served on a private listener

Metrics MUST be served in the Prometheus text format at `GET /metrics` on the address in `METRICS_ADDR`, and only
there. When `METRICS_ADDR` is unset no metrics endpoint exists. The public router MUST NOT serve them.
**Verified by:** `metrics_test.rs` (`metrics_listener_*`, `public_router_has_no_metrics`).

### REQ-OBS-007 [verified] Liveness and readiness are different questions

`GET /api/health/live` MUST answer `200` whenever the process can answer at all. `GET /api/health/ready` MUST answer
`200` `{ "ready": true }` while the API accepts work and `503` `server.unavailable` in the envelope once shutdown has
begun. `GET /api/health` keeps its report (REQ-API-012).
**Verified by:** `apps/api/tests/lifecycle_test.rs`.

### REQ-OBS-008 [verified] Shutdown drains

On `SIGTERM` or `SIGINT` the API MUST at once report not ready, stop accepting connections, let in-flight requests
finish for up to `SHUTDOWN_GRACE_MS` (default `10000`), and exit `0`, logging `shutdown started` and
`shutdown complete`. The signal MUST be injectable so the behaviour is tested without sending one.
**Verified by:** `lifecycle_test.rs` (`shutdown_*`).

### REQ-OBS-009 [verified] The start-up event says what is running

Start-up MUST log one `info` event, `service started`, with the version, the environment, the listening address and
the metrics address or `off`. It MUST NOT print a `Secret` (REQ-SEC-004) or the whole environment.
**Verified by:** `lifecycle_test.rs` (`startup_event_*`).

## The clients

### REQ-OBS-010 [verified] Every API call carries a trace

Each client MUST send `traceparent` on every API request. One user action is one trace: its retries (REQ-ERR-005) and
a token refresh made on its behalf (REQ-SEC-015) MUST reuse the trace id with a new span id each.
**Verified by:** `packages/api/tests/trace-headers.test.ts`, `TranApiClientTraceTests.swift`,
`TranApiClientTraceTest.kt`.

### REQ-OBS-011 [verified] A client failure can be joined to the server's logs

The client's `request failed` event and the event handed to the reporter (REQ-ERR-014) MUST carry the `trace_id` of
the call that failed, including when no response arrived. The fields MUST come from the generated schema of
REQ-OBS-002.
**Verified by:** `packages/core-ts/tests/feedback.test.ts`, `TranReportingTests.swift`, `TranReportingTest.kt`.
