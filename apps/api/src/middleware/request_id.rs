//! `x-request-id` on every response (REQ-ERR-002) and W3C `traceparent` propagation (REQ-OBS-003).
//! Reuse a well-formed incoming request id and traceparent; otherwise start a new trace / mint an id.
//! The id and trace scope the request's logs and are echoed in error bodies and logs.
//! Every request ends with one access-log event, `request completed` (REQ-OBS-004), carrying
//! `method`, `route`, `status`, `latency_ms`, `request_id`, `trace_id` (REQ-OBS-002) — at `info` level
//! for regular endpoints, or `debug` for health probes. The span's `path` is the [`loggable_path`].
//! The client is identified once ([`super::client::identify`]).

use std::time::Instant;

use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use rust_core::feedback::is_valid_request_id;
use rust_core::trace::{format_traceparent, parse_traceparent, TraceContext};
use tracing::Instrument;
use uuid::Uuid;

use super::client::{identify, NO_VERSION};
use crate::error::{REQUEST_ID, TRACE_ID};
use crate::metrics::{normalize_method, record_request_metrics, InFlightGuard};
use crate::routes::table::{is_health_path, loggable_path, matched_route_template};

pub const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
pub const TRACEPARENT_HEADER: HeaderName = HeaderName::from_static("traceparent");

fn resolve_trace_context(incoming: Option<&str>) -> TraceContext {
    if let Some(tp) = incoming {
        if let Some(parsed) = parse_traceparent(tp) {
            let mut bytes = [0u8; 8];
            let _ = getrandom::fill(&mut bytes);
            bytes[0] |= 1;
            return TraceContext {
                trace_id: parsed.trace_id,
                span_id: rust_core::trace::bytes_to_hex(&bytes),
                sampled: parsed.sampled,
            };
        }
    }
    let mut bytes = [0u8; 24];
    let _ = getrandom::fill(&mut bytes);
    bytes[0] |= 1;
    bytes[16] |= 1;
    TraceContext {
        trace_id: rust_core::trace::bytes_to_hex(&bytes[0..16]),
        span_id: rust_core::trace::bytes_to_hex(&bytes[16..24]),
        sampled: true,
    }
}

pub async fn request_id(mut request: Request, next: Next) -> Response {
    let _in_flight_guard = InFlightGuard::enter();
    let started = Instant::now();
    let norm_method = normalize_method(request.method());
    let id = request
        .headers()
        .get(&REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_valid_request_id(value))
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let incoming_tp = request
        .headers()
        .get(&TRACEPARENT_HEADER)
        .and_then(|value| value.to_str().ok());
    let trace_ctx = resolve_trace_context(incoming_tp);

    let client = identify(&mut request);
    let client_platform = client.platform.as_str();
    let client_version = client.version.as_deref().unwrap_or(NO_VERSION);
    let method_str = request.method().as_str().to_string();
    let raw_path = request.uri().path().to_string();

    let span = tracing::info_span!(
        "request",
        request_id = %id,
        trace_id = %trace_ctx.trace_id,
        span_id = %trace_ctx.span_id,
        method = %request.method(),
        path = %loggable_path(request.uri().path()),
        client_platform,
        client_version
    );

    request.extensions_mut().insert(trace_ctx.clone());

    let trace_id = trace_ctx.trace_id.clone();
    let mut response = REQUEST_ID
        .scope(
            id.clone(),
            TRACE_ID.scope(trace_id.clone(), next.run(request)),
        )
        .instrument(span.clone())
        .await;

    let status = response.status().as_u16();
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let route = matched_route_template(&raw_path);

    if is_health_path(&raw_path) {
        span.in_scope(|| {
            tracing::debug!(
                method = %method_str,
                route = %route,
                status,
                latency_ms,
                request_id = %id,
                trace_id = %trace_id,
                "request completed"
            )
        });
    } else {
        span.in_scope(|| {
            tracing::info!(
                method = %method_str,
                route = %route,
                status,
                latency_ms,
                request_id = %id,
                trace_id = %trace_id,
                "request completed"
            )
        });
    }

    let duration_seconds = started.elapsed().as_secs_f64();
    record_request_metrics(norm_method, &route, status, duration_seconds);

    #[allow(
        clippy::expect_used,
        reason = "the id is validated ASCII from `is_valid_request_id` or a fresh UUID"
    )]
    let req_value = HeaderValue::from_str(&id).expect("request ids are header-safe");
    response.headers_mut().insert(REQUEST_ID_HEADER, req_value);

    #[allow(
        clippy::expect_used,
        reason = "formatted traceparent is ASCII header-safe"
    )]
    let tp_value =
        HeaderValue::from_str(&format_traceparent(&trace_ctx)).expect("traceparent is header-safe");
    response.headers_mut().insert(TRACEPARENT_HEADER, tp_value);

    response
}
