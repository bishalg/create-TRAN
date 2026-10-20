// Verifies: REQ-ROB-003 REQ-ROB-004 REQ-ROB-007
//! Failures that need a misbehaving handler: panics and slow routes, run through the real layer
//! stack (`api::with_layers`) around test-only routes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration;

use api::state::AppState;
use api::{build_app, middleware::panic_response, with_layers, Limits};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use support::Captured;
use tower::ServiceExt;
use tracing::Level;

async fn call(app: Router, path: &str) -> (StatusCode, Option<String>, Value) {
    let request = Request::builder().uri(path).body(Body::empty()).unwrap();
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let id = response
        .headers()
        .get("x-request-id")
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        id,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn boom() -> &'static str {
    panic!("boom")
}

fn misbehaving(limits: Limits) -> Router {
    with_layers(
        Router::new().route("/boom", get(boom)).route(
            "/slow",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                "too late"
            }),
        ),
        limits,
    )
}

#[tokio::test]
async fn a_panic_answers_the_envelope_and_logs_one_error() {
    let (captured, _guard) = Captured::install();
    let (status, id, body) = call(misbehaving(Limits::default()), "/boom").await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["code"], "server.internal");
    assert_eq!(body["error"], "Internal server error");
    assert_eq!(body["request_id"].as_str(), id.as_deref());
    assert!(
        !body.to_string().contains("boom"),
        "the cause stays in the log"
    );

    let failures = captured.named("request failed");
    assert_eq!(failures.len(), 1, "{failures:?}");
    assert_eq!(failures[0].level, Level::ERROR);
    assert_eq!(failures[0].field("request_id"), id.as_deref());
    assert!(failures[0].field("detail").unwrap().contains("boom"));
}

#[tokio::test]
async fn a_non_string_panic_payload_is_still_answered() {
    let response = panic_response(Box::new(42_u8));
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn a_string_panic_payload_keeps_its_message() {
    let (captured, _guard) = Captured::install();
    panic_response(Box::new(String::from("owned message")));
    let failures = captured.named("request failed");
    assert_eq!(failures[0].field("detail"), Some("panic: owned message"));
}

#[tokio::test]
async fn a_slow_handler_answers_503_before_the_client_gives_up() {
    let (captured, _guard) = Captured::install();
    let limits = Limits {
        deadline: Duration::from_millis(20),
        ..Limits::default()
    };
    let (status, _, body) = call(misbehaving(limits), "/slow").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["code"], "server.unavailable");
    assert_eq!(body["retryable"], true);
    let failures = captured.named("request failed");
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].level, Level::WARN);
    assert_eq!(
        failures[0].field("detail"),
        Some("No response within 20 ms")
    );
}

#[tokio::test]
async fn a_success_logs_one_debug_completion_and_nothing_louder() {
    let (captured, _guard) = Captured::install();
    let (status, id, _) = call(build_app(AppState::new()), "/api/health").await;

    assert_eq!(status, StatusCode::OK);
    let events = captured.events();
    assert!(
        events.iter().all(|e| e.level == Level::DEBUG),
        "a healthy request is silent above debug: {events:?}"
    );
    let completed = captured.named("request completed");
    assert_eq!(completed.len(), 1, "{events:?}");
    assert_eq!(completed[0].field("status"), Some("200"));
    assert_eq!(completed[0].field("request_id"), id.as_deref());
    assert!(completed[0].field("latency_ms").is_some());
}

#[tokio::test]
async fn a_failure_logs_one_failure_and_one_completion() {
    let (captured, _guard) = Captured::install();
    let (status, _, _) = call(build_app(AppState::new()), "/api/nope").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(captured.named("request failed").len(), 1);
    let completed = captured.named("request completed");
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].field("status"), Some("404"));
}
