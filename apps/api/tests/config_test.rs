// Verifies: REQ-CFG-002 REQ-CFG-003 REQ-CFG-004 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
//! Integration tests for remote configuration route `GET /api/v1/config` (spec 029, ADR-0048).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::fs;
use std::sync::Arc;

use api::build_app;
use api::client_versions::{ClientThresholds, ClientVersionSettings, VersionThreshold};
use api::clock::ManualClock;
use api::config_source::FileConfigSource;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use chrono::{Duration, Utc};
use http_body_util::BodyExt;
use rust_core::flags::{Rule, BUCKET_HEADER, FLAG_NOTIFY_ME};
use serde_json::Value;
use tower::ServiceExt;

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Value,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }
}

async fn send(app: axum::Router, method: Method, path: &str, headers: &[(&str, &str)]) -> Reply {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let response = app
        .oneshot(builder.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

#[tokio::test]
async fn config_route_returns_200_and_all_declared_flags_with_defaults() {
    // Verifies: REQ-CFG-002 REQ-CFG-007
    let app = build_app(AppState::new());
    let reply = send(app.clone(), Method::GET, "/api/v1/config", &[]).await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("content-type"), Some("application/json"));
    let etag = reply.header("etag");
    assert!(etag.is_some());

    assert_eq!(reply.body["config_version"], 1);
    assert_eq!(reply.body["flags"][FLAG_NOTIFY_ME], false);
    assert!(reply.body["client"]["minimum_version"].is_null());
    assert!(reply.body["client"]["recommended_version"].is_null());

    // Answered per caller: private, revalidated, varying on the client and bucket headers.
    assert_eq!(reply.header("cache-control"), Some("private, no-cache"));
    let vary: Vec<&str> = reply
        .headers
        .get_all("vary")
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert!(
        vary.iter()
            .any(|v| v.contains("x-tran-client") && v.contains("x-tran-bucket")),
        "{vary:?}"
    );
}

/// A source with one rule: `notify_me` on for `rollout` percent.
fn rollout_app(rollout: u8) -> axum::Router {
    let clock = Arc::new(ManualClock::starting_at(Utc::now()));
    let mut rules = HashMap::new();
    rules.insert(
        FLAG_NOTIFY_ME.to_string(),
        vec![Rule {
            platform: None,
            min_version: None,
            rollout,
            value: rust_core::flags::FlagValue::Boolean(true),
        }],
    );
    let mut state = AppState::new();
    state.config_source = Arc::new(FileConfigSource::with_rules(rules, clock));
    build_app(state)
}

#[tokio::test]
async fn config_route_puts_a_caller_without_a_valid_bucket_outside_every_partial_rollout() {
    // Verifies: REQ-CFG-002 REQ-CFG-003
    let one_percent = rollout_app(1);
    for bucket in [
        None,
        Some("invalid-bucket"),
        Some("300"),
        Some("100"),
        Some("-1"),
        Some(""),
    ] {
        let headers: Vec<(&str, &str)> = bucket.map(|b| (BUCKET_HEADER, b)).into_iter().collect();
        let reply = send(one_percent.clone(), Method::GET, "/api/v1/config", &headers).await;
        assert_eq!(reply.status, StatusCode::OK);
        assert_eq!(reply.body["flags"][FLAG_NOTIFY_ME], false, "{bucket:?}");
    }
    let inside = send(
        one_percent,
        Method::GET,
        "/api/v1/config",
        &[(BUCKET_HEADER, "0")],
    )
    .await;
    assert_eq!(inside.body["flags"][FLAG_NOTIFY_ME], true);

    // A full rollout reaches every caller, with or without a bucket.
    let everyone = rollout_app(100);
    for headers in [
        &[][..],
        &[(BUCKET_HEADER, "99")],
        &[(BUCKET_HEADER, "junk")],
    ] {
        let reply = send(everyone.clone(), Method::GET, "/api/v1/config", headers).await;
        assert_eq!(reply.body["flags"][FLAG_NOTIFY_ME], true, "{headers:?}");
    }
}

#[tokio::test]
async fn config_route_lets_a_web_client_send_its_bucket_and_etag_across_origins() {
    // Verifies: REQ-CFG-002 REQ-API-007
    let app = build_app(AppState::new());
    let origin = "http://localhost:3000";
    let preflight = send(
        app.clone(),
        Method::OPTIONS,
        "/api/v1/config",
        &[
            ("origin", origin),
            ("access-control-request-method", "GET"),
            (
                "access-control-request-headers",
                "x-tran-bucket,if-none-match,x-tran-client",
            ),
        ],
    )
    .await;
    assert_eq!(preflight.status, StatusCode::OK);
    let allowed = preflight.header("access-control-allow-headers").unwrap();
    for name in ["x-tran-bucket", "if-none-match", "x-tran-client"] {
        assert!(allowed.contains(name), "{name} in {allowed}");
    }

    let reply = send(app, Method::GET, "/api/v1/config", &[("origin", origin)]).await;
    let exposed = reply.header("access-control-expose-headers").unwrap();
    assert!(exposed.contains("etag"), "{exposed}");
}

#[tokio::test]
async fn config_route_returns_304_on_matching_if_none_match() {
    // Verifies: REQ-CFG-002
    let app = build_app(AppState::new());
    let reply = send(app.clone(), Method::GET, "/api/v1/config", &[]).await;
    let etag = reply.header("etag").unwrap();

    let reply304 = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[(header::IF_NONE_MATCH.as_str(), etag)],
    )
    .await;
    assert_eq!(reply304.status, StatusCode::NOT_MODIFIED);
    assert_eq!(reply304.header("etag"), Some(etag));
    assert_eq!(reply304.header("cache-control"), Some("private, no-cache"));
    assert!(reply304.header("vary").is_some());

    // Weak ETag syntax also matches
    let weak_etag = format!("W/{etag}");
    let reply_weak = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[(header::IF_NONE_MATCH.as_str(), &weak_etag)],
    )
    .await;
    assert_eq!(reply_weak.status, StatusCode::NOT_MODIFIED);

    // Stale or different ETag answers 200 OK with fresh response
    let reply_stale = send(
        app,
        Method::GET,
        "/api/v1/config",
        &[(header::IF_NONE_MATCH.as_str(), "\"stale-different-etag\"")],
    )
    .await;
    assert_eq!(reply_stale.status, StatusCode::OK);
}

#[tokio::test]
async fn config_route_is_exempt_from_426_upgrade_required() {
    // Verifies: REQ-CFG-002 REQ-CFG-008
    let mut state = AppState::new();
    let thresholds = ClientThresholds::from_settings(&ClientVersionSettings {
        ios: VersionThreshold {
            minimum: Some("1.5.0".to_string()),
            recommended: Some("1.6.0".to_string()),
        },
        android: VersionThreshold::default(),
        web: VersionThreshold::default(),
    })
    .unwrap();
    state.edge.client_thresholds = Arc::new(thresholds);

    let app = build_app(state);

    // Another product route answers 426
    let reply_vote = send(
        app.clone(),
        Method::GET,
        "/api/v1/tran/info",
        &[("x-tran-client", "ios/1.2.0")],
    )
    .await;
    assert_eq!(reply_vote.status, StatusCode::UPGRADE_REQUIRED);

    // Config route is exempt and answers 200 with thresholds
    let reply_config = send(
        app,
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.2.0")],
    )
    .await;
    assert_eq!(reply_config.status, StatusCode::OK);
    assert_eq!(reply_config.body["client"]["minimum_version"], "1.5.0");
    assert_eq!(reply_config.body["client"]["recommended_version"], "1.6.0");
}

#[tokio::test]
async fn config_route_evaluates_rules_with_client_platform_version_and_bucket() {
    // Verifies: REQ-CFG-002 REQ-CFG-003 REQ-CFG-006
    let clock = Arc::new(ManualClock::starting_at(Utc::now()));
    let mut rules = HashMap::new();
    rules.insert(
        FLAG_NOTIFY_ME.to_string(),
        vec![Rule {
            platform: Some("ios".to_string()),
            min_version: Some("1.2.0".to_string()),
            rollout: 50,
            value: rust_core::flags::FlagValue::Boolean(true),
        }],
    );
    let mut state = AppState::new();
    state.config_source = Arc::new(FileConfigSource::with_rules(rules, clock));

    let app = build_app(state);

    // iOS 1.2.0 with bucket 20 matches rule (< 50)
    let reply_match = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.2.0"), (BUCKET_HEADER, "20")],
    )
    .await;
    assert_eq!(reply_match.body["flags"][FLAG_NOTIFY_ME], true);

    // iOS 1.2.0 with bucket 80 does not match rule (>= 50) -> default false
    let reply_bucket_miss = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.2.0"), (BUCKET_HEADER, "80")],
    )
    .await;
    assert_eq!(reply_bucket_miss.body["flags"][FLAG_NOTIFY_ME], false);

    // Android does not match platform -> default false
    let reply_platform_miss = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "android/1.2.0"), (BUCKET_HEADER, "20")],
    )
    .await;
    assert_eq!(reply_platform_miss.body["flags"][FLAG_NOTIFY_ME], false);

    // iOS 1.1.0 does not match min_version -> default false
    let reply_ver_miss = send(
        app,
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.1.0"), (BUCKET_HEADER, "20")],
    )
    .await;
    assert_eq!(reply_ver_miss.body["flags"][FLAG_NOTIFY_ME], false);
}

#[tokio::test]
async fn config_source_updates_on_injected_clock_after_max_age_and_ignores_bad_file() {
    // Verifies: REQ-CFG-004
    let dir = std::env::temp_dir().join(format!("tran-config-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let file_path = dir.join("rules.json");
    let clock = Arc::new(ManualClock::starting_at(Utc::now()));

    // Initial valid rule: notify_me enabled for 100% rollout
    fs::write(
        &file_path,
        r#"{
            "flags": {
                "notify_me": [
                    { "rollout": 100, "value": true }
                ]
            }
        }"#,
    )
    .unwrap();

    let mut state = AppState::new();
    state.config_source = Arc::new(FileConfigSource::new(
        Some(file_path.clone()),
        clock.clone(),
    ));
    let app = build_app(state);

    let reply1 = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.0.0"), (BUCKET_HEADER, "10")],
    )
    .await;
    assert_eq!(reply1.body["flags"][FLAG_NOTIFY_ME], true);

    // Update rule on disk to rollout 0 (disabled)
    fs::write(
        &file_path,
        r#"{
            "flags": {
                "notify_me": [
                    { "rollout": 0, "value": true }
                ]
            }
        }"#,
    )
    .unwrap();

    // Advance clock past max_age (300s)
    clock.advance(Duration::seconds(305));

    let reply2 = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.0.0"), (BUCKET_HEADER, "10")],
    )
    .await;
    assert_eq!(reply2.body["flags"][FLAG_NOTIFY_ME], false);

    // Overwrite file with malformed JSON
    fs::write(&file_path, "invalid json {{{{").unwrap();
    clock.advance(Duration::seconds(305));

    // Last good rules remain in force
    let reply3 = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.0.0"), (BUCKET_HEADER, "10")],
    )
    .await;
    assert_eq!(reply3.body["flags"][FLAG_NOTIFY_ME], false);

    // Overwrite file with rule naming an unknown flag
    fs::write(
        &file_path,
        r#"{
            "flags": {
                "totally_unknown_flag": [
                    { "rollout": 100, "value": true }
                ]
            }
        }"#,
    )
    .unwrap();
    clock.advance(Duration::seconds(305));

    // A file naming only an unknown flag: that rule is ignored, leaving no rules for notify_me
    let reply4 = send(
        app.clone(),
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.0.0"), (BUCKET_HEADER, "10")],
    )
    .await;
    assert_eq!(reply4.body["flags"][FLAG_NOTIFY_ME], false);

    // The deploy that removes a flag from the catalogue keeps every other flag's rules
    fs::write(
        &file_path,
        r#"{
            "flags": {
                "totally_unknown_flag": [ { "rollout": 100, "value": true } ],
                "notify_me": [ { "rollout": 100, "value": true } ]
            }
        }"#,
    )
    .unwrap();
    clock.advance(Duration::seconds(305));
    let reply5 = send(
        app,
        Method::GET,
        "/api/v1/config",
        &[("x-tran-client", "ios/1.0.0"), (BUCKET_HEADER, "10")],
    )
    .await;
    assert_eq!(reply5.body["flags"][FLAG_NOTIFY_ME], true);
}
