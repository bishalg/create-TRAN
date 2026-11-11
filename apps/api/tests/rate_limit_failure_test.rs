// Verifies: REQ-RL-010 REQ-ROB-003
//! Rate limit store failure modes and graceful degradation (spec 031, ADR-0050).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use api::db::StoreError;
use api::rate_limit_store::{MemoryRateLimitStore, RateLimitStore};
use axum::body::Body;
use axum::http::{Method, StatusCode};
use rust_core::rate::{ClassPolicy, RouteClass, TakeResult};
use serde_json::json;
use support::rate::RateApi;
use support::Captured;

fn sign_in_body() -> Body {
    Body::from(json!({ "role": "citizen_voter", "transport": "body" }).to_string())
}

// ── REQ-RL-010: A limiter failure does not take the API down ──────────────────

#[tokio::test]
async fn store_failure_fails_open_on_write_and_read_and_logs_once_per_window() {
    let api = RateApi::new(&[("TRUSTED_PROXIES", "127.0.0.1/32")], 100);
    let (captured, _guard) = Captured::install();
    api.store.set_failing(true);

    for _ in 0..3 {
        let read = api.read_as("", None).await;
        assert_eq!(read.status, StatusCode::OK);
    }
    let write = api
        .send(
            Method::PUT,
            "/api/v1/devices/00000000-0000-0000-0000-000000000000",
            None,
            &[],
            Body::empty(),
        )
        .await;
    assert_ne!(write.status, StatusCode::SERVICE_UNAVAILABLE);
    let failing_open = "rate limit store failed, failing open";
    assert_eq!(captured.named(failing_open).len(), 1, "once per window");

    api.clock.advance(chrono::Duration::seconds(60));
    api.read_as("", None).await;
    assert_eq!(
        captured.named(failing_open).len(),
        2,
        "again in the next window"
    );
}

#[tokio::test]
async fn store_failure_fails_closed_with_503_on_auth() {
    let api = RateApi::new(&[("TRUSTED_PROXIES", "127.0.0.1/32")], 100);
    let (captured, _guard) = Captured::install();
    api.store.set_failing(true);

    let auth_reply = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[],
            sign_in_body(),
        )
        .await;
    assert_eq!(auth_reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(auth_reply.json["code"], "server.unavailable");
    assert_eq!(auth_reply.retry_after(), Some(1));

    let refresh_reply = api.refresh_as("203.0.113.5", "some_token").await;
    assert_eq!(refresh_reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(refresh_reply.json["code"], "server.unavailable");
    assert_eq!(refresh_reply.retry_after(), Some(1));
    assert_eq!(
        captured
            .named("rate limit store failed on auth route")
            .len(),
        1
    );
}

#[tokio::test]
async fn store_failure_is_logged_even_right_after_a_limited_log_for_the_key() {
    let api = RateApi::new(&[("RATE_LIMIT_AUTH", "10/1")], 100);
    let (captured, _guard) = Captured::install();
    api.send(
        Method::POST,
        "/api/v1/auth/session",
        None,
        &[],
        sign_in_body(),
    )
    .await;
    let limited = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[],
            sign_in_body(),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(captured.named("rate limited").len(), 1);

    api.store.set_failing(true);
    let failed = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[],
            sign_in_body(),
        )
        .await;
    assert_eq!(failed.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        captured
            .named("rate limit store failed on auth route")
            .len(),
        1
    );
}

/// Fails the `n`th take (counting from 0), else delegates.
struct FailOnTake {
    inner: MemoryRateLimitStore,
    calls: AtomicUsize,
    fail_at: usize,
}

impl RateLimitStore for FailOnTake {
    fn take(
        &self,
        key: &str,
        class: RouteClass,
        policy: &ClassPolicy,
        now_ms: u64,
    ) -> Result<TakeResult, StoreError> {
        if self.calls.fetch_add(1, Ordering::SeqCst) == self.fail_at {
            return Err(StoreError::Failed);
        }
        self.inner.take(key, class, policy, now_ms)
    }

    fn should_log_limited(&self, key: &str, class: RouteClass, now_ms: u64) -> bool {
        self.inner.should_log_limited(key, class, now_ms)
    }
}

#[tokio::test]
async fn refresh_secondary_check_store_failure_fails_closed() {
    let mut api = RateApi::new(&[], 10);
    api.state.edge.rate_limit_store = Arc::new(FailOnTake {
        inner: MemoryRateLimitStore::new(10),
        calls: AtomicUsize::new(0),
        fail_at: 1,
    });
    let calls = api.sessions.calls();
    let first = api.refresh_as("203.0.113.6", "sample_token").await;
    assert_eq!(first.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(first.retry_after(), Some(1));
    assert_eq!(api.sessions.calls(), calls, "refused before rotating");

    // The next one reaches the store and is refused as unknown.
    let second = api.refresh_as("203.0.113.6", "sample_token_2").await;
    assert_eq!(second.status, StatusCode::UNAUTHORIZED);
}

/// A store whose every call panics, as a buggy fork's might.
struct Panicking;

impl RateLimitStore for Panicking {
    fn take(
        &self,
        _: &str,
        _: RouteClass,
        _: &ClassPolicy,
        _: u64,
    ) -> Result<TakeResult, StoreError> {
        panic!("limiter bug")
    }

    fn should_log_limited(&self, _: &str, _: RouteClass, _: u64) -> bool {
        panic!("limiter bug")
    }
}

// Verifies: REQ-RL-010 REQ-ROB-003
#[tokio::test]
async fn a_panic_in_the_limiter_answers_the_500_envelope() {
    let mut api = RateApi::new(&[], 10);
    api.state.edge.rate_limit_store = Arc::new(Panicking);
    let log = std::panic::catch_unwind(|| Panicking.should_log_limited("k", RouteClass::Read, 0));
    assert!(log.is_err());
    let reply = api.read_as("", None).await;
    assert_eq!(reply.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(reply.json["code"], "server.internal");
    assert!(reply.json["request_id"].is_string());
    // Health probes never reach the limiter.
    let live = api
        .send(Method::GET, "/api/health/live", None, &[], Body::empty())
        .await;
    assert_eq!(live.status, StatusCode::OK);
}
