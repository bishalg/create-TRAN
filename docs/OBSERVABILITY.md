# Observability runbook

How to see what the system is doing, and how to wire it to the backend a fork chooses. The rules are
[spec 023](./specs/023-observability.md); the reasons are [ADR-0040](./adr/0040-observability-open-formats-no-vendor.md).

## The three signals

| Signal  | Format                   | Where it comes from                                    | Joined by                |
| :------ | :----------------------- | :----------------------------------------------------- | :----------------------- |
| Logs    | JSON lines, fixed schema | API stdout; client failure events through the reporter | `trace_id`, `request_id` |
| Traces  | W3C `traceparent` header | Started by the client, continued by the API            | `trace_id`               |
| Metrics | Prometheus text          | `GET /metrics` on `METRICS_ADDR` (private)             | `route`, `status`        |

Two ids, two jobs. The **request id** is one HTTP exchange and is what a user reads out from an error dialog. The
**trace id** is one user action: the call, its retries and any token refresh made for it.

## Finding things

- **A user reports reference `abc-123`:** search the API logs for `request_id = "abc-123"`. Take the `trace_id` from
  that line and search again to see every exchange of that action, in order.
- **A client crash report arrives:** it carries `code`, `status`, `request_id` and `trace_id`. Search the API logs by
  `trace_id`; an empty result means the request never reached the API.
- **"Is it slow?"**
  `histogram_quantile(0.95, sum by (le, route) (rate(tran_http_request_duration_seconds_bucket[5m])))`
- **"Is it failing?"**
  `sum by (route) (rate(tran_http_requests_total{status=~"5.."}[5m])) / sum by (route) (rate(tran_http_requests_total[5m]))`
- **"What is deployed?"** `tran_build_info`, or the `service started` log event.

## Alerts worth having first

- Error ratio above 1% for 5 minutes on any route (page).
- p95 latency above the route's budget for 10 minutes (ticket).
- `up == 0` for the metrics target, or readiness failing for longer than a deploy takes (page).
- A sudden rise in `401` on `/api/auth/refresh` (ticket): a client bug, or replayed tokens.

## Lifecycle

- `GET /api/health/live`: the process answers. Point the liveness probe here; failing it restarts the process.
- `GET /api/health/ready`: the process accepts work. Point the readiness probe and the load balancer here.
- On `SIGTERM` readiness fails at once, in-flight requests get `SHUTDOWN_GRACE_MS` to finish, then the process exits
  `0`. Give the orchestrator a termination grace period longer than that.

## What a fork adds

- **A log shipper** that reads stdout (the platform's own, Vector, Fluent Bit). Nothing in the app changes.
- **A scraper** for `METRICS_ADDR` (Prometheus, the OpenTelemetry collector's Prometheus receiver, a vendor agent).
- **A reporter** on each client (`setErrorReporter`, `TranReporting`) for crash and failure events.
- **Span export**, if waterfall views are wanted: add an OpenTelemetry layer to the API's `tracing` subscriber. The
  trace ids already line up, because the header is the standard one.
- **Field performance data** from clients, next to the reporter, if CI budgets are not enough.

## Rules for a change

- A new log field goes in the Rust schema first; a field that is not there fails a test.
- A label or a `route` value is a template, never a path, an id or anything a client chose.
- Nothing from spec 022 is ever logged: no token, header value, cookie or body.
