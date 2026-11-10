# ADR-0040 Observability is three correlated signals in open formats, with no vendor SDK

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [023](../specs/023-observability.md)

## Context

The error work (ADR-0028, ADR-0029, ADR-0036) gave every failure a code, one log event and a request id, and gave each
client a reporter seam. That answers "what failed". It does not answer the questions an operator asks at 3 a.m.:

- **Is it slow or broken right now, and since when?** Nothing counts requests or measures them. The only timing is a
  `debug` log line that production filters out.
- **Which requests belong together?** A request id names one exchange. A retry, or a token refresh followed by the
  repeated call (ADR-0039), is several exchanges with unrelated ids.
- **Can I send it traffic? May I stop it?** `/api/health` reports versions. Nothing says "not ready", and the process
  dies on `SIGTERM` with requests in flight, which a rolling deploy turns into user-visible errors.

The obvious answer is an OpenTelemetry SDK on four platforms. That is a large dependency on each, a collector to run,
and a choice of backend, in a template whose reporter seam deliberately ships no vendor (ADR-0036).

## Decision

1. **Adopt the open wire formats, not an SDK.** Traces use the W3C `traceparent` header. Metrics use the Prometheus
   text format. Logs are JSON lines with a fixed schema. Every backend, and the OpenTelemetry collector, reads all
   three, so a fork picks a vendor by configuration and loses nothing by our not having picked one.

2. **Trace context is Rust, like every other shared rule.** Parsing, formatting and deriving a child span are pure
   functions in `rust-core` with injected randomness, pinned by `fixtures/trace.json` and reached through UniFFI and a
   TypeScript mirror. A header parser is exactly the kind of small code four hand-written copies get subtly wrong.

3. **One trace per user action.** The client starts the trace; its retries and any refresh made for it are new spans
   in the same trace. The API continues the trace it is given and starts one otherwise. The request id stays the
   reference a user reads to support; the trace id is how an engineer finds everything else.

4. **The log schema is data.** The events and their allowed fields are declared in Rust and generated, so "never log a
   payload" (REQ-ROB-007, REQ-SEC-014) is a list a test checks rather than a habit. The access-log event moves from
   `debug` to `info`: a production system that cannot say what it served is not observable.

5. **Labels and fields are bounded.** A metric label or a log `route` is the matched route template. Raw paths carry
   user input and unbounded values, which leak data into logs and explode a metrics store's cardinality.

6. **Metrics have their own listener.** They are served only on `METRICS_ADDR`, which stays inside the network, and
   not at all when it is unset. A `/metrics` route on the public port is an information leak waiting for a forgotten
   firewall rule.

7. **Liveness, readiness and shutdown are part of observability.** Liveness says "restart me if this fails".
   Readiness says "send me traffic", and turns false the moment shutdown starts. The process then drains in-flight
   requests within a deadline. These are the signals an orchestrator observes.

We use the `metrics` facade with its Prometheus exporter on the API, for the same reason the API uses `tracing`: the
call sites name no backend. The recorder handle lives in application state so tests read their own registry.

## Consequences

- A fork gets correlation and RED metrics on day one and can add an OpenTelemetry exporter behind the same call sites
  without touching a client.
- No spans are exported, so there are no waterfall views until a fork adds an exporter; logs joined by trace id are
  the substitute, and the runbook shows the query.
- The clients record no metrics. Client performance is measured by the budgets of ADR-0031 in CI, not in the field; a
  fork that wants field data adds a sink next to the reporter.
- `REQ-ROB-007` changes: the completion event is `info` and gains fields. Log volume in production rises to one line
  per request, which is the usual and intended cost.
- The API gains two dependencies (`metrics`, `metrics-exporter-prometheus`) and a second listener to configure.
- Shutdown takes up to the grace period. A deploy must allow at least that long before it kills the process.
