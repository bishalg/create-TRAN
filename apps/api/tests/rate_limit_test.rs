// Verifies: REQ-RL-003 REQ-RL-004 REQ-RL-005 REQ-RL-006 REQ-RL-008
//! Rate limiting and abuse protection integration tests (spec 031, ADR-0050).
//!
//! Naming follows the spec's "Verified by" lines: `key_*`, `rate_limit_*`, `auth_*`,
//! `store_is_bounded*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::Database;
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
use tracing::Level;

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
        let request = builder
            .extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                [127, 0, 0, 1],
                12345,
            ))))
            .body(body)
            .unwrap();
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

    async fn sign_in(&self, ip: &str) -> (String, String) {
        let body = json!({ "role": "citizen_voter", "transport": "body" }).to_string();
        let headers = if ip.is_empty() {
            vec![]
        } else {
            vec![("x-forwarded-for", ip)]
        };
        let reply = self
            .send(
                Method::POST,
                "/api/v1/auth/session",
                None,
                &headers,
                Body::from(body),
            )
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
        (
            reply.json["access_token"].as_str().unwrap().to_string(),
            reply.json["refresh_token"].as_str().unwrap().to_string(),
        )
    }
}

// ── REQ-RL-003: The key cannot be chosen by the caller ────────────────────────

#[tokio::test]
async fn key_signed_in_request_is_counted_by_user_id() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/3"),
        ],
        100,
    );
    let (access, _) = api.sign_in("203.0.113.1").await;

    // Burst is 3 tokens
    for _ in 0..3 {
        let reply = api
            .send(
                Method::GET,
                "/api/v1/vote/countries",
                Some(&access),
                &[("x-forwarded-for", "203.0.113.1")],
                Body::empty(),
            )
            .await;
        assert_eq!(reply.status, StatusCode::OK);
    }

    // A call from a different IP with the same user session hits the same bucket and gets 429
    let reply = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            Some(&access),
            &[("x-forwarded-for", "198.51.100.2")],
            Body::empty(),
        )
        .await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reply.json["code"], "server.rate_limited");

    // But an unauthenticated request from the new IP has its own IP bucket and is allowed
    let unauth_reply = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "198.51.100.2")],
            Body::empty(),
        )
        .await;
    assert_eq!(unauth_reply.status, StatusCode::OK);
}

#[tokio::test]
async fn key_unauthenticated_request_is_counted_by_client_ip() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/3"), // 3 burst for easy test
        ],
        100,
    );

    for _ in 0..3 {
        let reply = api
            .send(
                Method::GET,
                "/api/v1/vote/countries",
                None,
                &[("x-forwarded-for", "203.0.113.50")],
                Body::empty(),
            )
            .await;
        assert_eq!(reply.status, StatusCode::OK);
    }

    // 4th request from same IP is limited
    let limited = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "203.0.113.50")],
            Body::empty(),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);

    // Another IP is not limited
    let other = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "203.0.113.51")],
            Body::empty(),
        )
        .await;
    assert_eq!(other.status, StatusCode::OK);
}

#[tokio::test]
async fn key_trusted_proxies_extracts_rightmost_untrusted_address() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32, 10.0.0.0/8"),
            ("RATE_LIMIT_READ", "60/2"),
        ],
        100,
    );

    // Peer is 127.0.0.1 (trusted).
    // X-Forwarded-For: "203.0.113.99, 10.0.0.5" -> 10.0.0.5 is trusted, rightmost untrusted is 203.0.113.99
    for _ in 0..2 {
        let reply = api
            .send(
                Method::GET,
                "/api/v1/vote/countries",
                None,
                &[("x-forwarded-for", "203.0.113.99, 10.0.0.5")],
                Body::empty(),
            )
            .await;
        assert_eq!(reply.status, StatusCode::OK);
    }

    let limited = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "203.0.113.99, 10.0.0.5")],
            Body::empty(),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);

    // Different untrusted address is allowed
    let fresh = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "203.0.113.100, 10.0.0.5")],
            Body::empty(),
        )
        .await;
    assert_eq!(fresh.status, StatusCode::OK);

    // Trusted proxy with no X-Forwarded-For falls back to peer IP (127.0.0.1)
    let no_ff = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[],
            Body::empty(),
        )
        .await;
    assert_eq!(no_ff.status, StatusCode::OK);
}

#[tokio::test]
async fn key_forged_forwarded_for_is_ignored_when_peer_is_not_trusted() {
    // TRUSTED_PROXIES is empty -> peer 127.0.0.1 is untrusted
    let api = TestApi::new(&[("RATE_LIMIT_READ", "60/2")], 100);

    for _ in 0..2 {
        let reply = api
            .send(
                Method::GET,
                "/api/v1/vote/countries",
                None,
                &[("x-forwarded-for", "1.1.1.1")],
                Body::empty(),
            )
            .await;
        assert_eq!(reply.status, StatusCode::OK);
    }

    // Even if caller changes X-Forwarded-For, it is ignored and counted against peer 127.0.0.1
    let limited = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "2.2.2.2")],
            Body::empty(),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
}

// ── REQ-RL-004: A limited request gets one clear answer ───────────────────────

#[tokio::test]
async fn rate_limit_answers_429_with_retry_after_and_envelope() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/2"),
        ],
        100,
    );

    for _ in 0..2 {
        let reply = api
            .send(
                Method::POST,
                "/api/v1/auth/session",
                None,
                &[("x-forwarded-for", "203.0.113.10")],
                Body::from(json!({ "role": "citizen_voter", "transport": "body" }).to_string()),
            )
            .await;
        assert_eq!(reply.status, StatusCode::CREATED);
    }

    let limited = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[("x-forwarded-for", "203.0.113.10")],
            Body::from(json!({ "role": "citizen_voter", "transport": "body" }).to_string()),
        )
        .await;

    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.json["code"], "server.rate_limited");
    assert_eq!(limited.json["success"], false);
    assert_eq!(limited.json["retryable"], true);
    assert!(limited.json["request_id"].is_string());
    assert!(limited.retry_after().is_some());
    assert!(limited.retry_after().unwrap() >= 1);
}

#[tokio::test]
async fn rate_limit_gives_identical_answer_whether_target_exists_or_not() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/1"),
        ],
        100,
    );

    // 1st request burns the 1 token
    let _ = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[("x-forwarded-for", "203.0.113.20")],
            Body::from(json!({ "role": "citizen_voter", "transport": "body" }).to_string()),
        )
        .await;

    // Subsequent request with invalid/unknown credentials receives identical 429 envelope
    let bad_reply = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[("x-forwarded-for", "203.0.113.20")],
            Body::from(json!({ "role": "nonexistent_role", "transport": "body" }).to_string()),
        )
        .await;

    assert_eq!(bad_reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(bad_reply.json["code"], "server.rate_limited");
}

// ── REQ-RL-005: The auth routes are limited twice ─────────────────────────────

#[tokio::test]
async fn auth_routes_limited_by_ip_before_authentication() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/2"),
        ],
        100,
    );

    for _ in 0..2 {
        let reply = api
            .send(
                Method::POST,
                "/api/v1/auth/session",
                None,
                &[("x-forwarded-for", "203.0.113.30")],
                Body::from(json!({ "role": "bad_role", "transport": "body" }).to_string()),
            )
            .await;
        // Rejection before rate limiting is 400
        assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    }

    // 3rd request is blocked by rate limiting before authentication runs
    let limited = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[("x-forwarded-for", "203.0.113.30")],
            Body::from(json!({ "role": "citizen_voter", "transport": "body" }).to_string()),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.json["code"], "server.rate_limited");
}

#[tokio::test]
async fn auth_refresh_limited_by_session_across_multiple_ips() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/3"), // 3 burst
        ],
        100,
    );
    let (captured, _guard) = Captured::install();

    let (_, refresh) = api.sign_in("203.0.113.1").await;

    // Send 3 refreshes from different IPs with the same token
    for i in 2..=4 {
        let ip = format!("203.0.113.{i}");
        let body = json!({ "refresh_token": refresh }).to_string();
        let reply = api
            .send(
                Method::POST,
                "/api/v1/auth/refresh",
                None,
                &[("x-forwarded-for", &ip)],
                Body::from(body),
            )
            .await;
        // First might succeed or fail depending on rotation, but it is NOT 429
        assert_ne!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    }

    // 4th request from yet another IP with the same refresh token is limited per session
    let body = json!({ "refresh_token": refresh }).to_string();
    let reply = api
        .send(
            Method::POST,
            "/api/v1/auth/refresh",
            None,
            &[("x-forwarded-for", "203.0.113.99")],
            Body::from(body.clone()),
        )
        .await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reply.json["code"], "server.rate_limited");
    assert!(!captured.named("rate limited").is_empty());

    // 5th request: still limited, but should_log_limited is false (already logged in window)
    let reply2 = api
        .send(
            Method::POST,
            "/api/v1/auth/refresh",
            None,
            &[("x-forwarded-for", "203.0.113.100")],
            Body::from(body),
        )
        .await;
    assert_eq!(reply2.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn auth_failed_refresh_costs_the_same_token_as_successful_one() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/2"),
        ],
        100,
    );

    let fake_token = "invalid_token_format";
    for _ in 0..2 {
        let body = json!({ "refresh_token": fake_token }).to_string();
        let reply = api
            .send(
                Method::POST,
                "/api/v1/auth/refresh",
                None,
                &[("x-forwarded-for", "203.0.113.40")],
                Body::from(body),
            )
            .await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    }

    let body = json!({ "refresh_token": fake_token }).to_string();
    let limited = api
        .send(
            Method::POST,
            "/api/v1/auth/refresh",
            None,
            &[("x-forwarded-for", "203.0.113.40")],
            Body::from(body),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn auth_refresh_rejects_oversized_body() {
    let api = TestApi::new(&[("TRUSTED_PROXIES", "127.0.0.1/32")], 100);
    let huge_body = "x".repeat(5000);
    let reply = api
        .send(
            Method::POST,
            "/api/v1/auth/refresh",
            None,
            &[],
            Body::from(huge_body),
        )
        .await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.json["code"], "request.malformed");
}

// ── REQ-RL-006: The limiter's own memory is bounded ───────────────────────────

#[tokio::test]
async fn store_is_bounded_and_evicts_longest_idle_key() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        2, // capacity of 2 keys
    );
    assert!(api.store.is_empty());

    // Key 1
    let r1 = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "1.1.1.1")],
            Body::empty(),
        )
        .await;
    assert_eq!(r1.status, StatusCode::OK);

    // Key 2
    let r2 = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "2.2.2.2")],
            Body::empty(),
        )
        .await;
    assert_eq!(r2.status, StatusCode::OK);

    assert_eq!(api.store.len(), 2);

    // Key 3 forces eviction of Key 1
    let r3 = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "3.3.3.3")],
            Body::empty(),
        )
        .await;
    assert_eq!(r3.status, StatusCode::OK);
    assert_eq!(api.store.len(), 2);

    // Calling Key 1 again gets treated as a fresh bucket with full capacity (evicted oldest)
    let r1_again = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", "1.1.1.1")],
            Body::empty(),
        )
        .await;
    assert_eq!(r1_again.status, StatusCode::OK);
}

// ── REQ-RL-008: Limiting is visible to operators and silent about callers ─────

#[tokio::test]
async fn rate_limit_increments_metric_and_logs_without_pii() {
    let api = TestApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        100,
    );
    let (captured, _guard) = Captured::install();

    let ip = "192.0.2.123";
    let _ = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", ip)],
            Body::empty(),
        )
        .await;

    assert_eq!(api.store.rate_limited_count(RouteClass::Read), 0);

    // Limited request
    let limited = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", ip)],
            Body::empty(),
        )
        .await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(api.store.rate_limited_count(RouteClass::Read), 1);

    // Second limited request within the 60s window increments count but does NOT emit another log
    let limited2 = api
        .send(
            Method::GET,
            "/api/v1/vote/countries",
            None,
            &[("x-forwarded-for", ip)],
            Body::empty(),
        )
        .await;
    assert_eq!(limited2.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(api.store.rate_limited_count(RouteClass::Read), 2);

    let logs = captured.named("rate limited");
    assert_eq!(logs.len(), 1, "logged exactly once per window");
    let log = &logs[0];
    assert_eq!(log.level, Level::WARN);
    assert_eq!(log.field("class"), Some("read"));

    // Verify no address, user id or token in the log
    let line = log.line();
    assert!(!line.contains(ip), "log must not contain IP: {line}");
    assert!(
        !line.contains("user"),
        "log must not contain user id: {line}"
    );
}
