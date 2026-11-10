// Verifies: REQ-RL-010
//! Rate limit store failure modes and graceful degradation (spec 031, ADR-0050).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::{Database, StoreError};
use api::rate_limit_store::{MemoryRateLimitStore, RateLimitStore};
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use rust_core::rate::RouteClass;
use serde_json::{json, Value};
use support::Captured;
use tower::ServiceExt;

static SERIAL: Mutex<()> = Mutex::new(());

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    json: Value,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    fn retry_after(&self) -> Option<u64> {
        self.header("retry-after").and_then(|v| v.parse().ok())
    }
}

struct TestApi {
    state: AppState,
    store: Arc<MemoryRateLimitStore>,
    _serial: MutexGuard<'static, ()>,
}

impl TestApi {
    fn new(pairs: &[(&str, &str)], max_keys: usize) -> Self {
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let config = AppConfig::from_lookup(|key| {
            pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
        });
        let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let clock = Arc::new(ManualClock::starting_at(start));
        let store = Arc::new(MemoryRateLimitStore::new(max_keys));
        let state = AppState {
            sessions: Sessions::sql(Database::in_memory(), clock),
            rate_limit_store: store.clone(),
            ..AppState::from_config(&config)
        };
        Self {
            state,
            store,
            _serial: serial,
        }
    }

    async fn send(
        &self,
        method: Method,
        uri: &str,
        bearer: Option<&str>,
        headers: &[(&str, &str)],
        body: Body,
    ) -> Reply {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = bearer {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        for (name, val) in headers {
            builder = builder.header(*name, *val);
        }
        let request = builder.body(body).unwrap();
        let response = build_app(self.state.clone())
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        Reply {
            status,
            headers,
            json,
        }
    }
}

// ── REQ-RL-010: A limiter failure does not take the API down ──────────────────

#[tokio::test]
async fn store_failure_fails_open_on_write_and_read() {
    let api = TestApi::new(&[("TRUSTED_PROXIES", "127.0.0.1/32")], 100);
    let (captured, _guard) = Captured::install();
    api.store.set_failing(true);

    // Read route fails open -> serves 200
    let read_reply = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[],
            Body::empty(),
        )
        .await;
    assert_eq!(read_reply.status, StatusCode::OK);

    // Write route fails open -> reaches handler (handler rejects bad json or serves)
    let write_reply = api
        .send(
            Method::PUT,
            "/api/v1/devices/00000000-0000-0000-0000-000000000000",
            None,
            &[],
            Body::empty(),
        )
        .await;
    assert_ne!(write_reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(!captured
        .named("rate limit store failed, failing open")
        .is_empty());
}

#[tokio::test]
async fn store_failure_fails_closed_with_503_on_auth() {
    let api = TestApi::new(&[("TRUSTED_PROXIES", "127.0.0.1/32")], 100);
    let (captured, _guard) = Captured::install();
    api.store.set_failing(true);

    let auth_reply = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[],
            Body::from(json!({ "role": "citizen_voter", "transport": "body" }).to_string()),
        )
        .await;

    assert_eq!(auth_reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(auth_reply.json["code"], "server.unavailable");
    assert_eq!(auth_reply.retry_after(), Some(1));
    assert_eq!(
        captured
            .named("rate limit store failed on auth route")
            .len(),
        1
    );

    let refresh_reply = api
        .send(
            Method::POST,
            "/api/v1/auth/refresh",
            None,
            &[],
            Body::from(json!({ "refresh_token": "some_token" }).to_string()),
        )
        .await;

    assert_eq!(refresh_reply.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(refresh_reply.json["code"], "server.unavailable");
    assert_eq!(refresh_reply.retry_after(), Some(1));
}

struct FailOnSecondTakeStore {
    inner: MemoryRateLimitStore,
    calls: std::sync::atomic::AtomicUsize,
}

impl RateLimitStore for FailOnSecondTakeStore {
    fn take(
        &self,
        key: &str,
        class: RouteClass,
        policy: &rust_core::rate::ClassPolicy,
        now_ms: u64,
    ) -> Result<rust_core::rate::TakeResult, StoreError> {
        let n = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if n == 1 {
            return Err(StoreError::Failed);
        }
        self.inner.take(key, class, policy, now_ms)
    }

    fn record_limited(&self, class: RouteClass) {
        self.inner.record_limited(class);
    }

    fn rate_limited_count(&self, class: RouteClass) -> u64 {
        self.inner.rate_limited_count(class)
    }

    fn should_log_limited(&self, key: &str, now_ms: u64) -> bool {
        self.inner.should_log_limited(key, now_ms)
    }
}

// Verifies: REQ-RL-010
#[tokio::test]
async fn refresh_secondary_check_store_failure_fails_closed() {
    let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
    let clock = Arc::new(ManualClock::starting_at(start));
    let store = Arc::new(FailOnSecondTakeStore {
        inner: MemoryRateLimitStore::new(10),
        calls: std::sync::atomic::AtomicUsize::new(0),
    });
    let state = AppState {
        sessions: Sessions::sql(Database::in_memory(), clock),
        rate_limit_store: store.clone(),
        ..AppState::new()
    };
    let app = build_app(state);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/refresh")
        .header(header::CONTENT_TYPE, "application/json")
        .header("cookie", "tran_refresh=sample_token")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(resp.headers().get(header::RETRY_AFTER).unwrap(), "1");

    // Subsequent call where calls != 1 proceeds to session validation (returns 401 for unknown token)
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/refresh")
        .header(header::CONTENT_TYPE, "application/json")
        .header("cookie", "tran_refresh=sample_token_2")
        .body(Body::empty())
        .unwrap();
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::UNAUTHORIZED);

    store.record_limited(RouteClass::Auth);
    assert_eq!(store.rate_limited_count(RouteClass::Auth), 1);
    assert!(store.should_log_limited("k", 1000));
}
