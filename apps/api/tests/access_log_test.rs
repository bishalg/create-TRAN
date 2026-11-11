// Verifies: REQ-OBS-004
//! Access log verification (spec 023, REQ-OBS-004):
//! exactly one `request completed` event per request with the fields of REQ-OBS-002,
//! route is the matched template or "unmatched", level is info except for health probes (debug),
//! and raw paths, query strings, headers or bodies are never logged.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use api::build_app;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use rust_core::feedback::REQUEST_COMPLETED_EVENT;
use support::Captured;
use tokio::sync::Mutex;
use tower::ServiceExt;
use tracing::Level;

static SERIAL: Mutex<()> = Mutex::const_new(());

#[tokio::test]
async fn completed_request_logs_one_event_with_exact_schema_at_info() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/vote/countries")
        .header("x-request-id", "access-req-001")
        .header(
            "traceparent",
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        )
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let completions = captured.named(REQUEST_COMPLETED_EVENT.message);
    assert_eq!(completions.len(), 1);
    let event = &completions[0];

    assert_eq!(event.level, Level::INFO);

    for field in REQUEST_COMPLETED_EVENT.fields {
        assert!(
            event.field(field).is_some(),
            "missing required field '{field}' in {event:?}"
        );
    }

    assert_eq!(event.field("method"), Some("GET"));
    assert_eq!(event.field("route"), Some("/api/v1/vote/countries"));
    assert_eq!(event.field("status"), Some("200"));
    assert_eq!(event.field("request_id"), Some("access-req-001"));
    assert_eq!(
        event.field("trace_id"),
        Some("4bf92f3577b34da6a3ce929d0e0e4736")
    );
    let latency: u64 = event
        .field("latency_ms")
        .unwrap()
        .parse()
        .expect("latency_ms must be numeric");
    assert!(latency <= 5000);
}

#[tokio::test]
async fn route_template_used_instead_of_raw_path_and_query_stripped() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/vote/countries/NP?query_token=secret_12345&filter=active")
        .header("x-request-id", "access-req-002")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let completions = captured.named(REQUEST_COMPLETED_EVENT.message);
    assert_eq!(completions.len(), 1);
    let event = &completions[0];

    assert_eq!(event.field("route"), Some("/api/v1/vote/countries/{code}"));

    let line = event.line();
    assert!(
        !line.contains("query_token"),
        "query string must not be in log: {line}"
    );
    assert!(
        !line.contains("secret_12345"),
        "query parameter value must not be in log: {line}"
    );
}

#[tokio::test]
async fn unmatched_route_logs_unmatched() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/some-random-unknown-route")
        .header("x-request-id", "access-req-003")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let completions = captured.named(REQUEST_COMPLETED_EVENT.message);
    assert_eq!(completions.len(), 1);
    let event = &completions[0];

    assert_eq!(event.level, Level::INFO);
    assert_eq!(event.field("route"), Some("unmatched"));
    assert_eq!(event.field("status"), Some("404"));
    assert_eq!(event.field("request_id"), Some("access-req-003"));
}

// Verifies: REQ-OBS-004
#[tokio::test]
async fn an_unmatched_path_and_a_custom_method_never_reach_the_log() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::from_bytes(b"BREWCOFFEE").unwrap())
        .uri("/api/v1/users/alice@example.com")
        .header("x-request-id", "access-req-004")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let completions = captured.named(REQUEST_COMPLETED_EVENT.message);
    assert_eq!(completions.len(), 1);
    let event = &completions[0];
    assert_eq!(event.field("route"), Some("unmatched"));
    assert_eq!(event.field("method"), Some("OTHER"));
    // The request span's own fields, which the JSON log prints as well.
    assert_eq!(event.field("path"), Some("unmatched"));
    assert_eq!(event.field("span.method"), None, "span and event agree");
    for event in captured.events() {
        let line = event.line();
        assert!(!line.contains("alice"), "raw path in the log: {line}");
        assert!(
            !line.contains("BREWCOFFEE"),
            "raw method in the log: {line}"
        );
    }
}

#[tokio::test]
async fn health_probes_log_at_debug_level() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/health")
        .header("x-request-id", "access-req-health")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let completions = captured.named(REQUEST_COMPLETED_EVENT.message);
    assert_eq!(completions.len(), 1);
    let event = &completions[0];

    assert_eq!(
        event.level,
        Level::DEBUG,
        "health probes must log at debug level so they do not drown the rest"
    );
    assert_eq!(event.field("route"), Some("/api/health"));
    assert_eq!(event.field("status"), Some("200"));
}

#[tokio::test]
async fn sensitive_headers_and_payload_never_logged() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = build_app(AppState::new());

    let sensitive_token = "ultra-secret-bearer-token-12345";
    let sensitive_payload = "super-secret-user-data-content";

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/vote/eligibility")
        .header(header::AUTHORIZATION, format!("Bearer {sensitive_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-request-id", "access-req-sensitive")
        .body(Body::from(format!(
            r#"{{"age": 25, "secret": "{sensitive_payload}"}}"#
        )))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let completions = captured.named(REQUEST_COMPLETED_EVENT.message);
    assert_eq!(completions.len(), 1);
    let event = &completions[0];

    let line = event.line();
    assert!(
        !line.contains(sensitive_token),
        "auth token must not be in log line: {line}"
    );
    assert!(
        !line.contains(sensitive_payload),
        "payload must not be in log line: {line}"
    );
}
