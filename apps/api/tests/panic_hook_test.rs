// Verifies: REQ-ROB-003
//! The panic hook is process-global, so it gets its own test binary with a single test.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use api::middleware::install_panic_hook;
use api::{with_layers, Limits};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::Router;
use support::Captured;
use tower::ServiceExt;
use tracing::Level;

async fn in_a_handler() -> &'static str {
    panic!("in a handler")
}

#[tokio::test]
async fn panics_are_logged_through_tracing_once_with_their_location() {
    install_panic_hook();
    let (captured, _guard) = Captured::install();

    // Outside a request: the hook logs it (instead of Rust printing to stderr).
    let outside = std::panic::catch_unwind(|| -> u8 { panic!("at startup") });
    assert!(outside.is_err());
    let startup = captured.named("panic outside a request");
    assert_eq!(startup.len(), 1, "{:?}", captured.events());
    assert_eq!(startup[0].level, Level::ERROR);
    assert!(startup[0].field("panic").unwrap().contains("at startup"));

    // Inside a request: one `request failed` event that says where it happened.
    let app = with_layers(
        Router::new().route("/boom", get(in_a_handler)),
        Limits::default(),
    );
    let request = Request::builder().uri("/boom").body(Body::empty()).unwrap();
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let failures = captured.named("request failed");
    assert_eq!(failures.len(), 1, "{:?}", captured.events());
    let detail = failures[0].field("detail").unwrap();
    assert!(
        detail.starts_with("panic at apps/api/tests/panic_hook_test.rs:"),
        "{detail}"
    );
    assert!(detail.ends_with(": in a handler"), "{detail}");
    assert_eq!(captured.named("panic outside a request").len(), 1);
}
