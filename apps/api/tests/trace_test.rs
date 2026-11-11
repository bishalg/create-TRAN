// Verifies: REQ-OBS-003
//! W3C trace context propagation (spec 023, REQ-OBS-003):
//! continues an incoming trace or starts a fresh one, carries trace_id and request_id on all log
//! events, and allows traceparent in CORS preflight.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use api::build_app;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use rust_core::trace::{is_valid_span_id, is_valid_trace_id, parse_traceparent};
use support::Captured;
use tokio::sync::Mutex;
use tower::ServiceExt;

static SERIAL: Mutex<()> = Mutex::const_new(());

#[tokio::test]
async fn valid_traceparent_continues_trace_with_new_span() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let incoming_trace = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/tran/info")
        .header("traceparent", incoming_trace)
        .header("x-request-id", "trace-req-001")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let tp_header = res
        .headers()
        .get("traceparent")
        .and_then(|v| v.to_str().ok())
        .expect("traceparent header must be present in response");

    let parsed = parse_traceparent(tp_header).expect("response traceparent must be valid");
    assert_eq!(parsed.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
    assert_ne!(parsed.span_id, "00f067aa0ba902b7");
    assert!(is_valid_span_id(&parsed.span_id));
    assert!(parsed.sampled);

    let completed = captured.named("request completed");
    assert_eq!(completed.len(), 1);
    let event = &completed[0];
    assert_eq!(
        event.field("trace_id"),
        Some("4bf92f3577b34da6a3ce929d0e0e4736")
    );
    assert_eq!(event.field("request_id"), Some("trace-req-001"));
}

#[tokio::test]
async fn missing_traceparent_starts_new_trace() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/tran/info")
        .header("x-request-id", "trace-req-002")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let tp_header = res
        .headers()
        .get("traceparent")
        .and_then(|v| v.to_str().ok())
        .expect("traceparent header must be present in response");

    let parsed = parse_traceparent(tp_header).expect("response traceparent must be valid");
    assert!(is_valid_trace_id(&parsed.trace_id));
    assert!(is_valid_span_id(&parsed.span_id));

    let completed = captured.named("request completed");
    assert_eq!(completed.len(), 1);
    let event = &completed[0];
    assert_eq!(event.field("trace_id"), Some(parsed.trace_id.as_str()));
    assert_eq!(event.field("request_id"), Some("trace-req-002"));
}

#[tokio::test]
async fn invalid_traceparent_starts_new_trace() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/tran/info")
        .header("traceparent", "invalid-traceparent-value")
        .header("x-request-id", "trace-req-003")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let tp_header = res
        .headers()
        .get("traceparent")
        .and_then(|v| v.to_str().ok())
        .expect("traceparent header must be present in response");

    let parsed = parse_traceparent(tp_header).expect("response traceparent must be valid");
    assert!(is_valid_trace_id(&parsed.trace_id));
    assert!(is_valid_span_id(&parsed.span_id));

    let completed = captured.named("request completed");
    assert_eq!(completed.len(), 1);
    let event = &completed[0];
    assert_eq!(event.field("trace_id"), Some(parsed.trace_id.as_str()));
    assert_eq!(event.field("request_id"), Some("trace-req-003"));
}

#[tokio::test]
async fn all_log_events_carry_trace_id_and_request_id() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let incoming_trace = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/vote/eligibility")
        .header("content-type", "application/json")
        .header("traceparent", incoming_trace)
        .header("x-request-id", "trace-req-004")
        .body(Body::from("{ malformed json }"))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let failures = captured.named("request failed");
    assert_eq!(failures.len(), 1);
    let failure_event = &failures[0];
    assert_eq!(
        failure_event.field("trace_id"),
        Some("4bf92f3577b34da6a3ce929d0e0e4736")
    );
    assert_eq!(failure_event.field("request_id"), Some("trace-req-004"));

    let completions = captured.named("request completed");
    assert_eq!(completions.len(), 1);
    let completion_event = &completions[0];
    assert_eq!(
        completion_event.field("trace_id"),
        Some("4bf92f3577b34da6a3ce929d0e0e4736")
    );
    assert_eq!(completion_event.field("request_id"), Some("trace-req-004"));
}

#[tokio::test]
async fn preflight_permits_traceparent_header() {
    let _lock = SERIAL.lock().await;
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/v1/vote/eligibility")
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            "traceparent, x-request-id, content-type",
        )
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert!(res.status().is_success());

    let allowed = res
        .headers()
        .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    assert!(
        allowed.contains("traceparent"),
        "preflight must allow traceparent: {allowed}"
    );

    let actual_req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/tran/info")
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap();

    let actual_res = app.oneshot(actual_req).await.unwrap();
    let exposed = actual_res
        .headers()
        .get(header::ACCESS_CONTROL_EXPOSE_HEADERS)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    assert!(
        exposed.contains("traceparent"),
        "actual response must expose traceparent: {exposed}"
    );
}
