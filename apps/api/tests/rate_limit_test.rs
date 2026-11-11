// Verifies: REQ-RL-001 REQ-RL-003 REQ-RL-004 REQ-RL-005 REQ-RL-006 REQ-RL-008
//! Rate limiting and abuse protection integration tests (spec 031, ADR-0050).
//!
//! Naming follows the spec's "Verified by" lines: `key_*`, `rate_limit_*`, `auth_*`,
//! `store_is_bounded*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use axum::body::Body;
use axum::http::{Method, StatusCode};
use serde_json::json;
use support::rate::{limited_total, RateApi};
use support::Captured;
use tracing::Level;

const READ_3: [(&str, &str); 2] = [
    ("TRUSTED_PROXIES", "127.0.0.1/32"),
    ("RATE_LIMIT_READ", "60/3"),
];

// ── REQ-RL-003: The key cannot be chosen by the caller ────────────────────────

#[tokio::test]
async fn key_signed_in_request_is_counted_by_user_id() {
    let api = RateApi::new(&READ_3, 100);
    let (access, _) = api.sign_in("203.0.113.1").await;

    for _ in 0..3 {
        let reply = api.read_as("203.0.113.1", Some(&access)).await;
        assert_eq!(reply.status, StatusCode::OK);
    }

    // The same user from another address shares the user's bucket.
    let reply = api.read_as("198.51.100.2", Some(&access)).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reply.json["code"], "server.rate_limited");

    // An anonymous request from that address has its own bucket.
    assert_eq!(
        api.read_as("198.51.100.2", None).await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn key_unauthenticated_request_is_counted_by_client_ip() {
    let api = RateApi::new(&READ_3, 100);
    for _ in 0..3 {
        assert_eq!(
            api.read_as("203.0.113.50", None).await.status,
            StatusCode::OK
        );
    }
    let limited = api.read_as("203.0.113.50", None).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        api.read_as("203.0.113.51", None).await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn key_an_unknown_bearer_token_is_counted_by_address() {
    // A forged token per request must not buy a fresh bucket per request.
    let api = RateApi::new(&READ_3, 100);
    for n in 0..3 {
        let forged = format!("forged-{n}");
        let reply = api.read_as("203.0.113.60", Some(&forged)).await;
        assert_eq!(reply.status, StatusCode::OK);
    }
    let reply = api.read_as("203.0.113.60", Some("forged-4")).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn key_a_token_checked_by_a_handler_is_counted_by_user_from_then_on() {
    let api = RateApi::new(&READ_3, 100);
    let (access, _) = api.sign_in("203.0.113.70").await;
    // As if another process had issued it: this one does not know the token yet.
    let mut api = api;
    api.state.edge.signed_in = std::sync::Arc::new(api::signed_in::SignedInKeys::new(100));
    let me = api
        .send(
            Method::GET,
            "/api/v1/auth/session",
            Some(&access),
            &[],
            Body::empty(),
        )
        .await;
    assert_eq!(me.status, StatusCode::OK);
    assert!(!api.state.edge.signed_in.is_empty());
    for _ in 0..3 {
        let reply = api.read_as("203.0.113.71", Some(&access)).await;
        assert_eq!(reply.status, StatusCode::OK);
    }
    // The user's bucket is empty; the address 203.0.113.72 has never been seen.
    let reply = api.read_as("203.0.113.72", Some(&access)).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn key_trusted_proxies_extracts_rightmost_untrusted_address() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32, 10.0.0.0/8"),
            ("RATE_LIMIT_READ", "60/2"),
        ],
        100,
    );
    // The peer 127.0.0.1 and the hop 10.0.0.5 are trusted: the client is 203.0.113.99.
    for _ in 0..2 {
        let reply = api.read_as("203.0.113.99, 10.0.0.5", None).await;
        assert_eq!(reply.status, StatusCode::OK);
    }
    let limited = api.read_as("6.6.6.6, 203.0.113.99, 10.0.0.5", None).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    let fresh = api.read_as("203.0.113.100, 10.0.0.5", None).await;
    assert_eq!(fresh.status, StatusCode::OK);
    // No header: the trusted peer itself.
    assert_eq!(api.read_as("", None).await.status, StatusCode::OK);
}

#[tokio::test]
async fn key_an_unparsable_hop_cannot_steer_the_key() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        100,
    );
    // Each request names a new forged address left of a hop that does not parse: all are
    // counted as the peer, so the second is limited.
    let first = api.read_as("6.6.6.1, 203.0.113.7:1:2", None).await;
    assert_eq!(first.status, StatusCode::OK);
    let second = api.read_as("6.6.6.2, 203.0.113.7:1:2", None).await;
    assert_eq!(second.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn key_forged_forwarded_for_is_ignored_when_peer_is_not_trusted() {
    let api = RateApi::new(&[("RATE_LIMIT_READ", "60/2")], 100);
    for ip in ["1.1.1.1", "2.2.2.2"] {
        assert_eq!(api.read_as(ip, None).await.status, StatusCode::OK);
    }
    let limited = api.read_as("3.3.3.3", None).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn key_x_real_ip_has_no_effect() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        100,
    );
    for (ip, want) in [
        ("198.51.100.1", StatusCode::OK),
        ("198.51.100.2", StatusCode::TOO_MANY_REQUESTS),
    ] {
        let reply = api
            .send(
                Method::GET,
                "/api/v1/vote/countries",
                None,
                &[("x-real-ip", ip)],
                Body::empty(),
            )
            .await;
        assert_eq!(reply.status, want, "{ip}");
    }
}

// ── REQ-RL-001: Every route has a class ───────────────────────────────────────

#[tokio::test]
async fn rate_limit_covers_the_config_route_and_exempts_health_probes() {
    let api = RateApi::new(&[("RATE_LIMIT_READ", "60/1")], 100);
    let config = |uri: &'static str| api.send(Method::GET, uri, None, &[], Body::empty());
    assert_eq!(config("/api/v1/config").await.status, StatusCode::OK);
    assert_eq!(
        config("/api/v1/config").await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    for _ in 0..3 {
        assert_eq!(config("/api/health/live").await.status, StatusCode::OK);
    }
}

// ── REQ-RL-004: A limited request gets one clear answer ───────────────────────

#[tokio::test]
async fn rate_limit_answers_429_with_retry_after_and_envelope() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/2"),
        ],
        100,
    );
    for _ in 0..2 {
        api.sign_in("203.0.113.10").await;
    }
    let body = json!({ "role": "citizen_voter", "transport": "body" }).to_string();
    let limited = api
        .send(
            Method::POST,
            "/api/v1/auth/session",
            None,
            &[("x-forwarded-for", "203.0.113.10")],
            Body::from(body),
        )
        .await;

    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.json["code"], "server.rate_limited");
    assert_eq!(
        limited.json["error"],
        "Too many requests. Please wait a moment and try again."
    );
    assert_eq!(limited.json["success"], false);
    assert_eq!(limited.json["retryable"], true);
    assert!(limited.json["request_id"].is_string());
    // 10 per minute: one token every 6 s.
    assert_eq!(limited.retry_after(), Some(6));
}

#[tokio::test]
async fn rate_limit_gives_identical_answer_whether_target_exists_or_not() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/1"),
        ],
        100,
    );
    // The only token of this address buys a real session from another address.
    let (_, real) = api.sign_in("203.0.113.19").await;
    let spend = api
        .refresh_as("203.0.113.20", "nobody-has-this-token")
        .await;
    assert_eq!(spend.status, StatusCode::UNAUTHORIZED);

    let existing = api.refresh_as("203.0.113.20", &real).await;
    let missing = api
        .refresh_as("203.0.113.20", "nobody-has-this-token-either")
        .await;
    for reply in [&existing, &missing] {
        assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    }
    let strip = |reply: &support::rate::Reply| {
        let mut json = reply.json.clone();
        json["request_id"] = serde_json::Value::Null;
        (
            json,
            reply.retry_after(),
            reply.header("set-cookie").map(str::to_owned),
        )
    };
    assert_eq!(strip(&existing), strip(&missing));
}

#[tokio::test]
async fn rate_limit_a_limited_request_never_reaches_the_session_store() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        100,
    );
    let (access, _) = api.sign_in("203.0.113.30").await;
    let before = api.sessions.calls();

    // A signed-in read: the first reaches the store to authenticate, the limited one does not.
    let me = |token: &str| {
        let token = token.to_string();
        let api = &api;
        async move {
            api.send(
                Method::GET,
                "/api/v1/auth/session",
                Some(&token),
                &[],
                Body::empty(),
            )
            .await
        }
    };
    assert_eq!(me(&access).await.status, StatusCode::OK);
    assert_eq!(api.sessions.calls(), before + 1);
    assert_eq!(me(&access).await.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(api.sessions.calls(), before + 1);

    // A forged token is counted by address: once that is spent, the store is not asked either.
    let forged = me("forged").await;
    assert_eq!(forged.status, StatusCode::UNAUTHORIZED);
    let calls = api.sessions.calls();
    assert_eq!(
        me("forged-again").await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(api.sessions.calls(), calls);
}

// ── REQ-RL-005: The auth routes are limited twice ─────────────────────────────

#[tokio::test]
async fn auth_routes_limited_by_ip_before_authentication() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/2"),
        ],
        100,
    );
    let bad = json!({ "role": "bad_role", "transport": "body" }).to_string();
    for _ in 0..2 {
        let reply = api
            .send(
                Method::POST,
                "/api/v1/auth/session",
                None,
                &[("x-forwarded-for", "203.0.113.30")],
                Body::from(bad.clone()),
            )
            .await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    }
    let calls = api.sessions.calls();
    let limited = api.refresh_as("203.0.113.30", "anything").await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.json["code"], "server.rate_limited");
    assert_eq!(api.sessions.calls(), calls, "limited before the store");
}

#[tokio::test]
async fn auth_refresh_limited_by_token_across_multiple_ips() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/3"),
        ],
        100,
    );
    let (captured, _guard) = Captured::install();
    let (_, refresh) = api.sign_in("203.0.113.1").await;

    // Three uses of one token from three addresses: the first rotates, the rest are replays.
    for i in 2..=4 {
        let reply = api.refresh_as(&format!("203.0.113.{i}"), &refresh).await;
        assert_ne!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    }

    // The token's own bucket is empty, whatever address presents it next.
    let calls = api.sessions.calls();
    let reply = api.refresh_as("203.0.113.99", &refresh).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reply.json["code"], "server.rate_limited");
    assert_eq!(api.sessions.calls(), calls, "limited before rotating");
    assert_eq!(captured.named("rate limited").len(), 1);

    let reply2 = api.refresh_as("203.0.113.100", &refresh).await;
    assert_eq!(reply2.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(captured.named("rate limited").len(), 1, "once per window");
}

#[tokio::test]
async fn auth_failed_refresh_costs_the_same_token_as_successful_one() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_AUTH", "10/2"),
        ],
        100,
    );
    for ip in ["203.0.113.40", "203.0.113.41"] {
        let reply = api.refresh_as(ip, "invalid_token_format").await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
    }
    let limited = api.refresh_as("203.0.113.42", "invalid_token_format").await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn auth_refresh_body_is_left_to_the_handler_and_the_stack_limits() {
    // The limiter no longer reads bodies: any body reaches the refresh handler inside the body
    // and time limits, which answers a body it cannot use (too large, or no token) as an unknown
    // token, as before the limiter existed. It is never the limiter's `400 request.malformed`.
    let api = RateApi::new(&[], 100);
    for size in [5_000, 17 * 1024] {
        let reply = api
            .send(
                Method::POST,
                "/api/v1/auth/refresh",
                None,
                &[],
                Body::from("x".repeat(size)),
            )
            .await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{size}");
        assert_eq!(reply.json["code"], "auth.session_expired", "{size}");
    }
}

// ── REQ-RL-006: The limiter's own memory is bounded ───────────────────────────

#[tokio::test]
async fn store_is_bounded_and_evicts_longest_idle_key() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        2,
    );
    assert!(api.store.is_empty());
    assert_eq!(api.read_as("1.1.1.1", None).await.status, StatusCode::OK);
    assert_eq!(api.read_as("2.2.2.2", None).await.status, StatusCode::OK);
    // Touch 1.1.1.1 (limited) so 2.2.2.2 is the one idle longest.
    let touched = api.read_as("1.1.1.1", None).await;
    assert_eq!(touched.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(api.read_as("3.3.3.3", None).await.status, StatusCode::OK);
    assert_eq!(api.store.len(), 2);
    // 1.1.1.1 kept its empty bucket; 2.2.2.2 was evicted and starts full.
    let kept = api.read_as("1.1.1.1", None).await;
    assert_eq!(kept.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(api.read_as("2.2.2.2", None).await.status, StatusCode::OK);

    // A flood of new addresses never grows it past the bound.
    for n in 0..50 {
        api.read_as(&format!("198.51.100.{n}"), None).await;
        assert!(api.store.len() <= 2);
    }
}

#[tokio::test]
async fn store_is_bounded_and_drops_buckets_idle_for_a_refill_period() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        100,
    );
    api.read_as("1.1.1.1", None).await;
    api.read_as("2.2.2.2", None).await;
    assert_eq!(api.store.len(), 2);
    api.clock.advance(chrono::Duration::seconds(1));
    api.read_as("3.3.3.3", None).await;
    assert_eq!(
        api.store.len(),
        1,
        "full again after one refill period: dropped"
    );
}

// ── REQ-RL-008: Limiting is visible to operators and silent about callers ─────

#[tokio::test]
async fn rate_limit_increments_metric_and_logs_without_pii() {
    let api = RateApi::new(
        &[
            ("TRUSTED_PROXIES", "127.0.0.1/32"),
            ("RATE_LIMIT_READ", "60/1"),
        ],
        100,
    );
    let (captured, _guard) = Captured::install();
    let ip = "192.0.2.123";
    let before = limited_total(&api.state, "read");
    assert_eq!(api.read_as(ip, None).await.status, StatusCode::OK);
    assert_eq!(limited_total(&api.state, "read"), before);

    for n in 1..=2 {
        let limited = api.read_as(ip, None).await;
        assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(limited_total(&api.state, "read"), before + n);
    }

    let logs = captured.named("rate limited");
    assert_eq!(logs.len(), 1, "logged exactly once per window");
    let log = &logs[0];
    assert_eq!(log.level, Level::WARN);
    assert_eq!(log.field("class"), Some("read"));
    let line = log.line();
    assert!(!line.contains(ip), "log must not contain IP: {line}");
    assert!(
        !line.contains("user"),
        "log must not contain user id: {line}"
    );
}
