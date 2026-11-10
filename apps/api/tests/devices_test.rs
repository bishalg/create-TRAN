// Verifies: REQ-PSH-001 REQ-PSH-002 REQ-PSH-003 REQ-PSH-004 REQ-PSH-007
//! The device routes against the real router, in-memory stores and a manual clock
//! (`support/devices.rs`). Naming follows the spec's "Verified by" lines: `register_*`,
//! `unregister_*`, `a_token_moves_to_its_newest_owner`, `sign_out_*`, `replay_*`,
//! `account_deletion_*`, `foreign_origin_*`, `logs_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use api::clock::Clock;
use api::devices::DevicePlatform;
use api::push::payload::{OpaqueId, ELIGIBILITY_REACHED};
use api::push::sender::ProviderAnswer;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use chrono::Duration;
use serde_json::{json, Value};
use support::devices::*;
use support::Captured;
use tracing::Level;

// ── Registering (REQ-PSH-001) ───────────────────────────────────────────────

#[tokio::test]
async fn register_answers_204_binds_the_caller_and_is_idempotent() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;

    for _ in 0..2 {
        assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "PUT");
    }
    let registrations = api.registrations("voter-001");
    assert_eq!(registrations.len(), 1, "idempotent");
    let registration = &registrations[0];
    assert_eq!(registration.platform, DevicePlatform::Ios);
    assert_eq!(registration.environment.as_str(), "sandbox");
    assert_eq!(registration.locale, "ne-NP");
    assert_eq!(registration.app_version, "1.4.0");
    assert!(!registration.marketing);
    assert_eq!(registration.refreshed_at, api.clock.now());

    let upper = PHONE.to_ascii_uppercase();
    let shouted = IOS_TOKEN.to_ascii_uppercase();
    assert_no_content(
        &api.register(&voter, &upper, ios(&shouted)).await,
        "either case",
    );
    assert_eq!(
        api.tokens("voter-001"),
        [IOS_TOKEN],
        "one id, one token spelling"
    );

    assert_no_content(
        &api.register(&voter, TABLET, android(&android_token()))
            .await,
        "FCM",
    );
    let tablet = api.registrations("voter-001");
    assert_eq!(tablet.len(), 2);
    assert!(tablet.iter().any(|r| r.platform == DevicePlatform::Android
        && r.environment.as_str() == "production"
        && !r.marketing));
}

#[tokio::test]
async fn register_without_a_valid_token_answers_401_and_stores_nothing() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    for (label, session) in [
        (
            "unknown",
            Session {
                access: "unknown".into(),
                refresh: String::new(),
            },
        ),
        (
            "refresh as access",
            Session {
                access: voter.refresh.clone(),
                refresh: String::new(),
            },
        ),
    ] {
        let reply = api.register(&session, PHONE, ios(IOS_TOKEN)).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{label}");
        assert_eq!(reply.json["code"], "auth.session_expired", "{label}");
        let reply = api.unregister(&session, PHONE).await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{label}");
    }
    let request = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/v1/devices/{PHONE}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(ios(IOS_TOKEN).to_string()))
        .unwrap();
    assert_eq!(api.send(request).await.status, StatusCode::UNAUTHORIZED);
    assert!(api.registrations("voter-001").is_empty());
}

#[tokio::test]
async fn register_validates_every_field_without_echoing_it() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let with = |field: &str, value: Value| {
        let mut body = ios(IOS_TOKEN);
        body[field] = value;
        body
    };
    let mut unknown = ios(IOS_TOKEN);
    unknown["user_id"] = json!("auditor-001");
    let mut missing = ios(IOS_TOKEN);
    missing.as_object_mut().unwrap().remove("locale");
    let cases: Vec<(&str, &str, Value)> = vec![
        ("not a uuid", "SENTINEL-install", ios(IOS_TOKEN)),
        (
            "a version-1 uuid",
            "2f1c7a5e-8b0d-1c3e-9f6a-1d2e3f4a5b6c",
            ios(IOS_TOKEN),
        ),
        (
            "a uuid without hyphens",
            "2f1c7a5e8b0d4c3e9f6a1d2e3f4a5b6c",
            ios(IOS_TOKEN),
        ),
        (
            "an unknown platform",
            PHONE,
            with("platform", json!("windows")),
        ),
        (
            "an unknown environment",
            PHONE,
            with("environment", json!("staging")),
        ),
        (
            "a short APNs token",
            PHONE,
            with("push_token", json!("a1b2c3")),
        ),
        (
            "a non-hex APNs token",
            PHONE,
            with("push_token", json!(format!("SENTINEL{}", &IOS_TOKEN[8..]))),
        ),
        (
            "an FCM token on iOS",
            PHONE,
            with("push_token", json!(android_token())),
        ),
        ("an empty locale", PHONE, with("locale", json!(""))),
        (
            "a locale with an underscore",
            PHONE,
            with("locale", json!("en_US")),
        ),
        (
            "a huge locale",
            PHONE,
            with("locale", json!("en-".to_string() + &"a".repeat(40))),
        ),
        (
            "a version that is not one",
            PHONE,
            with("app_version", json!("SENTINEL-v")),
        ),
        (
            "marketing as a string",
            PHONE,
            with("marketing", json!("yes")),
        ),
        ("an unknown field", PHONE, unknown),
        ("a missing field", PHONE, missing),
    ];
    for (label, id, body) in cases {
        let reply = api.register(&voter, id, body).await;
        assert_malformed(&reply, label);
        assert!(!reply.raw.contains("SENTINEL"), "{label}: {}", reply.raw);
        assert!(!reply.raw.contains(IOS_TOKEN), "{label}: {}", reply.raw);
    }
    let mut sandbox_android = android(&android_token());
    sandbox_android["environment"] = json!("sandbox");
    assert_malformed(
        &api.register(&voter, PHONE, sandbox_android).await,
        "android sandbox",
    );
    let fcm_bad = android(&format!("{}/{}", "a".repeat(40), "b".repeat(40)));
    assert_malformed(
        &api.register(&voter, PHONE, fcm_bad).await,
        "FCM token with a slash",
    );
    let reply = api
        .put_raw(&voter, PHONE, "{\"platform\":".into(), &[])
        .await;
    assert_malformed(&reply, "truncated JSON");
    let reply = api
        .put_raw(&voter, "%FF", ios(IOS_TOKEN).to_string(), &[])
        .await;
    assert_malformed(&reply, "an undecodable path");
    assert_malformed(
        &api.unregister(&voter, "SENTINEL").await,
        "DELETE with a bad id",
    );
    assert!(api.registrations("voter-001").is_empty(), "nothing stored");
}

#[tokio::test]
async fn register_accepts_no_other_method() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    for method in [Method::GET, Method::POST, Method::PATCH] {
        let request = Request::builder()
            .method(method.clone())
            .uri(format!("/api/v1/devices/{PHONE}"))
            .header(header::AUTHORIZATION, bearer(&voter.access))
            .body(Body::empty())
            .unwrap();
        let reply = api.send(request).await;
        assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED, "{method}");
        assert_eq!(reply.json["code"], "route.method_not_allowed", "{method}");
    }
}

// ── One token, one user (REQ-PSH-002) ───────────────────────────────────────

#[tokio::test]
async fn a_token_moves_to_its_newest_owner() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let auditor = api.sign_in("election_auditor").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "voter");
    assert_no_content(
        &api.register(&voter, TABLET, ios(IOS_TOKEN_2)).await,
        "voter tablet",
    );

    // The phone is handed over: a new install on it gets the same token.
    let reinstall = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    assert_no_content(
        &api.register(&auditor, reinstall, ios(IOS_TOKEN)).await,
        "auditor",
    );
    assert_eq!(api.tokens("voter-001"), [IOS_TOKEN_2]);
    assert_eq!(api.tokens("auditor-001"), [IOS_TOKEN]);

    // The same installation signs in as someone else: the registration follows the newest user.
    assert_no_content(
        &api.register(&auditor, TABLET, ios(IOS_TOKEN_2)).await,
        "same install",
    );
    assert!(api.tokens("voter-001").is_empty());
    assert_eq!(api.tokens("auditor-001"), [IOS_TOKEN_2, IOS_TOKEN]);
}

// ── Ending a session ends its registrations (REQ-PSH-003) ───────────────────

#[tokio::test]
async fn sign_out_removes_the_registrations_made_in_that_session_only() {
    let api = Api::new();
    let phone = api.sign_in("citizen_voter").await;
    let tablet = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&phone, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&tablet, TABLET, ios(IOS_TOKEN_2)).await,
        "tablet",
    );

    let body = json!({ "refresh_token": phone.refresh }).to_string();
    assert_eq!(
        api.send(post("/api/v1/auth/sign-out", body)).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        api.tokens("voter-001"),
        [IOS_TOKEN_2],
        "without any call from the device"
    );

    let body = json!({ "refresh_token": "unknown" }).to_string();
    assert_eq!(
        api.send(post("/api/v1/auth/sign-out", body)).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(api.tokens("voter-001"), [IOS_TOKEN_2]);
}

#[tokio::test]
async fn replay_of_a_refresh_token_removes_the_sessions_registrations() {
    let api = Api::new();
    let stolen = api.sign_in("citizen_voter").await;
    let other = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&stolen, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&other, TABLET, ios(IOS_TOKEN_2)).await,
        "tablet",
    );

    let body = json!({ "refresh_token": stolen.refresh }).to_string();
    assert_eq!(
        api.send(post("/api/v1/auth/refresh", body.clone()))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        api.tokens("voter-001").len(),
        2,
        "a rotation keeps the session"
    );
    assert_eq!(
        api.send(post("/api/v1/auth/refresh", body)).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(api.tokens("voter-001"), [IOS_TOKEN_2]);
}

#[tokio::test]
async fn account_deletion_removes_every_registration_of_the_user() {
    let api = Api::new();
    let phone = api.sign_in("citizen_voter").await;
    let tablet = api.sign_in("citizen_voter").await;
    let auditor = api.sign_in("election_auditor").await;
    assert_no_content(&api.register(&phone, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&tablet, TABLET, android(&android_token()))
            .await,
        "tablet",
    );
    let auditor_install = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    assert_no_content(
        &api.register(&auditor, auditor_install, ios(IOS_TOKEN_2))
            .await,
        "auditor",
    );

    let request = Request::builder()
        .method(Method::DELETE)
        .uri("/api/v1/account")
        .header(header::AUTHORIZATION, bearer(&phone.access))
        .body(Body::empty())
        .unwrap();
    assert_eq!(api.send(request).await.status, StatusCode::NO_CONTENT);
    assert!(api.registrations("voter-001").is_empty());
    assert_eq!(api.tokens("auditor-001"), [IOS_TOKEN_2]);
}

// ── Unregistering (REQ-PSH-004) ─────────────────────────────────────────────

#[tokio::test]
async fn unregister_removes_only_the_callers_registration_and_always_answers_204() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let auditor = api.sign_in("election_auditor").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "voter");

    assert_no_content(&api.unregister(&auditor, PHONE).await, "another user's");
    assert_eq!(
        api.tokens("voter-001"),
        [IOS_TOKEN],
        "not the auditor's to remove"
    );
    assert_no_content(&api.unregister(&voter, PHONE).await, "own");
    assert!(api.registrations("voter-001").is_empty());
    assert_no_content(&api.unregister(&voter, PHONE).await, "again");
}

// ── Origin, cache and CORS (REQ-SEC-012, REQ-API-007) ───────────────────────

#[tokio::test]
async fn foreign_origin_cannot_register_or_unregister_a_device() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let body = ios(IOS_TOKEN).to_string();
    let refused = api
        .put_raw(&voter, PHONE, body.clone(), &[("origin", FOREIGN_ORIGIN)])
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.json["code"], "auth.forbidden");
    assert_eq!(refused.header(header::CACHE_CONTROL), Some("no-store"));
    assert!(api.registrations("voter-001").is_empty());

    let allowed = api
        .put_raw(&voter, PHONE, body, &[("origin", LOCAL_ORIGIN)])
        .await;
    assert_no_content(&allowed, "allowed origin");
    assert_eq!(
        allowed.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(LOCAL_ORIGIN)
    );

    let request = Request::builder()
        .method(Method::DELETE)
        .uri(format!("/api/v1/devices/{PHONE}"))
        .header(header::AUTHORIZATION, bearer(&voter.access))
        .header(header::ORIGIN, FOREIGN_ORIGIN)
        .body(Body::empty())
        .unwrap();
    assert_eq!(api.send(request).await.status, StatusCode::FORBIDDEN);
    assert_eq!(api.tokens("voter-001"), [IOS_TOKEN]);
}

#[tokio::test]
async fn foreign_origin_check_comes_with_a_cors_preflight_that_allows_put() {
    let api = Api::new();
    let request = Request::builder()
        .method(Method::OPTIONS)
        .uri(format!("/api/v1/devices/{PHONE}"))
        .header(header::ORIGIN, LOCAL_ORIGIN)
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "PUT")
        .header(
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            "authorization,content-type",
        )
        .body(Body::empty())
        .unwrap();
    let reply = api.send(request).await;
    assert!(reply.status.is_success(), "{}", reply.status);
    let methods = reply.header(header::ACCESS_CONTROL_ALLOW_METHODS).unwrap();
    assert!(
        methods.contains("PUT") && methods.contains("DELETE"),
        "{methods}"
    );
}

// ── Logs (REQ-PSH-007) ──────────────────────────────────────────────────────

#[tokio::test]
async fn logs_carry_fixed_fields_and_never_a_token_an_installation_or_a_user() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let fcm = android_token();
    let (captured, _guard) = Captured::install();

    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(&api.register(&voter, TABLET, android(&fcm)).await, "tablet");
    let mut bad = ios(IOS_TOKEN);
    bad["locale"] = json!("SENTINEL_locale");
    assert_malformed(&api.register(&voter, PHONE, bad).await, "bad locale");
    api.sender.answer(IOS_TOKEN, ProviderAnswer::TokenDead);
    api.sender.answer(&fcm, ProviderAnswer::Rejected);
    let id = OpaqueId::parse("evt_7Hq2-x9").unwrap();
    api.push()
        .notify("voter-001", &ELIGIBILITY_REACHED, &id)
        .await
        .unwrap();
    assert_no_content(&api.unregister(&voter, TABLET).await, "unregister");
    api.clock.advance(Duration::days(61));
    api.prune().await;

    let registered = captured.named("device registered");
    assert_eq!(registered.len(), 2, "{registered:?}");
    assert_eq!(registered[0].level, Level::INFO);
    let fields: Vec<&str> = registered[0].fields.keys().map(String::as_str).collect();
    assert_eq!(
        fields,
        [
            "client_platform",
            "client_version",
            "environment",
            "method",
            "path",
            "platform",
            "replaced",
            "request_id"
        ]
    );
    assert_eq!(
        registered[0].field("path"),
        Some("/api/v1/devices/{installation_id}")
    );
    assert_eq!(registered[1].field("platform"), Some("android"));
    assert_eq!(
        captured.named("device unregistered")[0].field("removed"),
        Some("true")
    );
    let dead = captured.named("push token dead; registration removed");
    assert_eq!(dead[0].field("platform"), Some("ios"));
    let rejected = captured.named("push rejected by the provider");
    assert_eq!(
        (rejected[0].level, rejected[0].field("platform")),
        (Level::WARN, Some("android"))
    );
    assert_eq!(
        captured.named("database pruned")[0].field("devices"),
        Some("0")
    );
    assert_eq!(captured.named("request failed").len(), 1);

    let upper = PHONE.to_ascii_uppercase();
    for event in captured.events() {
        let line = event.line();
        for secret in [
            IOS_TOKEN,
            fcm.as_str(),
            PHONE,
            upper.as_str(),
            TABLET,
            "voter-001",
            "SENTINEL",
            "evt_7Hq2",
        ] {
            assert!(!line.contains(secret), "log leaks {secret}: {line}");
        }
    }
}
