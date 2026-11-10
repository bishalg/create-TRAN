// Verifies: REQ-PSH-005 REQ-PSH-007
//! The real APNs and FCM senders against a local fake provider, with throwaway keys made by the
//! test (ADR-0046): the JWTs, the request shapes, token reuse and refresh, every reply in the
//! `providerReplies` section of `fixtures/push.json`, and transport failures. No request leaves
//! the machine. Naming follows the spec's "Verified by" lines: `apns_*`, `fcm_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;

use api::clock::ManualClock;
use api::devices::{DevicePlatform, InstallationId, PushEnvironment, PushToken, Registration};
use api::push::apns::APNS_TOKEN_REFRESH_AFTER;
use api::push::fcm::{fcm_error, FcmError, FCM_SCOPE, FCM_TOKEN_MARGIN, GOOGLE_TOKEN_ENDPOINT};
use api::push::payload::{apns_request, fcm_message, OpaqueId, ELIGIBILITY_REACHED};
use api::push::sender::{ProviderAnswer, PushMessage, PushSender};
use api::push::transport::{HttpClient, Protocol};
use api::session_store::SessionId;
use axum::http::Version;
use chrono::Duration;
use serde_json::{json, Value};
use support::devices::{android_token, IOS_TOKEN, TOPIC};
use support::providers::*;

fn clock() -> Arc<ManualClock> {
    Arc::new(ManualClock::starting_at(start()))
}

fn registration(
    platform: DevicePlatform,
    environment: PushEnvironment,
    token: &str,
) -> Registration {
    Registration {
        installation: InstallationId::random(),
        user_id: "voter-001".to_string(),
        session: SessionId(1),
        platform,
        environment,
        token: PushToken::parse(platform, token).unwrap(),
        locale: "en".to_string(),
        app_version: "1.4.0".to_string(),
        marketing: false,
        refreshed_at: start(),
    }
}

fn ios(environment: PushEnvironment) -> Registration {
    registration(DevicePlatform::Ios, environment, IOS_TOKEN)
}

fn android() -> Registration {
    registration(
        DevicePlatform::Android,
        PushEnvironment::Production,
        &android_token(),
    )
}

fn id() -> OpaqueId {
    OpaqueId::parse("evt_7Hq2-x9").unwrap()
}

fn apns_message() -> PushMessage {
    PushMessage::Apns(apns_request(&ELIGIBILITY_REACHED, &id(), "en", TOPIC))
}

fn fcm_body() -> Value {
    fcm_message(&ELIGIBILITY_REACHED, &id(), "en")
}

fn fixtures() -> Value {
    serde_json::from_str(include_str!("../../../fixtures/push.json")).unwrap()
}

fn bearer_of(received: &Received, scheme: &str) -> String {
    received
        .header("authorization")
        .strip_prefix(&format!("{scheme} "))
        .unwrap()
        .to_string()
}

// ── APNs ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn apns_provider_token_is_an_es256_jwt_that_verifies() {
    let fake = FakeProvider::start().await;
    let sender = apns_sender(&fake, clock());
    let jwt = verify_es256(sender.provider_token().expose());
    assert_eq!(jwt.header, json!({ "alg": "ES256", "kid": KEY_ID }));
    assert_eq!(
        jwt.claims,
        json!({ "iss": TEAM_ID, "iat": start().timestamp() })
    );
}

#[tokio::test]
async fn apns_provider_token_is_reused_inside_apples_window_then_refreshed() {
    let fake = FakeProvider::start().await;
    let clock = clock();
    let sender = apns_sender(&fake, clock.clone());
    let first = sender.provider_token();
    clock.advance(APNS_TOKEN_REFRESH_AFTER - Duration::seconds(1));
    assert_eq!(sender.provider_token(), first, "reused under 50 minutes");
    assert!(APNS_TOKEN_REFRESH_AFTER >= Duration::minutes(20));
    assert!(APNS_TOKEN_REFRESH_AFTER < Duration::minutes(60));

    clock.advance(Duration::seconds(1));
    let second = sender.provider_token();
    assert_ne!(second, first, "refreshed at 50 minutes");
    let claims = verify_es256(second.expose()).claims;
    assert_eq!(
        claims["iat"],
        (start() + APNS_TOKEN_REFRESH_AFTER).timestamp()
    );

    clock.advance(Duration::minutes(-10));
    let third = sender.provider_token();
    assert_ne!(third, second, "a token dated in the future is replaced");
}

#[tokio::test]
async fn apns_request_has_apples_shape_over_http2() {
    let fake = FakeProvider::start().await;
    let sender = apns_sender(&fake, clock());
    let message = apns_message();
    for environment in [PushEnvironment::Sandbox, PushEnvironment::Production] {
        let answer = sender.send(&ios(environment), &message).await;
        assert_eq!(answer, ProviderAnswer::Delivered);
    }
    let sends = fake.sends();
    assert_eq!(sends.len(), 2);
    let pinned = &fixtures()["payloads"][0]["apns"];
    for (sent, gateway) in sends.iter().zip(["sandbox", "production"]) {
        assert_eq!(sent.method, "POST");
        assert_eq!(sent.path, format!("/{gateway}/3/device/{IOS_TOKEN}"));
        assert_eq!(sent.version, Version::HTTP_2, "APNs speaks HTTP/2 only");
        for (name, value) in pinned["headers"].as_object().unwrap() {
            assert_eq!(sent.header(name), value.as_str().unwrap(), "{name}");
        }
        assert_eq!(sent.header("apns-priority"), "10");
        verify_es256(&bearer_of(sent, "bearer"));
        assert_eq!(sent.json(), pinned["body"]);
    }
    assert_eq!(
        bearer_of(&sends[0], "bearer"),
        bearer_of(&sends[1], "bearer"),
        "one provider token for both gateways"
    );
}

async fn replies_for(platform: &str) -> Vec<(String, u16, String, ProviderAnswer)> {
    fixtures()["providerReplies"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["platform"] == platform)
        .map(|case| {
            let body = match &case["body"] {
                Value::Null => String::new(),
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            (
                case["name"].as_str().unwrap().to_string(),
                u16::try_from(case["status"].as_u64().unwrap()).unwrap(),
                body,
                answer_named(case["answer"].as_str().unwrap()),
            )
        })
        .collect()
}

#[tokio::test]
async fn apns_every_pinned_reply_maps_to_its_answer() {
    let fake = FakeProvider::start().await;
    let sender = apns_sender(&fake, clock());
    let cases = replies_for("ios").await;
    assert!(cases.len() >= 12);
    for (name, status, body, expected) in cases {
        fake.script_sends([Script::Reply(status, body)]);
        let answer = sender
            .send(&ios(PushEnvironment::Production), &apns_message())
            .await;
        assert_eq!(answer, expected, "{name}");
    }
}

#[tokio::test]
async fn apns_expired_provider_token_is_replaced_on_the_next_send() {
    let fake = FakeProvider::start().await;
    let sender = apns_sender(&fake, clock());
    let registration = ios(PushEnvironment::Production);
    fake.script_sends([
        Script::json(403, &json!({ "reason": "ExpiredProviderToken" })),
        Script::json(403, &json!({ "reason": "InvalidProviderToken" })),
    ]);
    for _ in 0..3 {
        sender.send(&registration, &apns_message()).await;
    }
    let tokens: Vec<String> = fake
        .sends()
        .iter()
        .map(|s| bearer_of(s, "bearer"))
        .collect();
    assert_ne!(
        tokens[0], tokens[1],
        "a new token after ExpiredProviderToken"
    );
    assert_eq!(tokens[1], tokens[2], "kept after any other refusal");
}

#[tokio::test]
async fn apns_transport_failures_retry_later() {
    let fake = FakeProvider::start().await;
    let sender = apns_sender(&fake, clock());
    let registration = ios(PushEnvironment::Production);
    fake.script_sends([Script::Hang, Script::Broken]);
    for label in ["timeout", "broken body"] {
        let answer = sender.send(&registration, &apns_message()).await;
        assert_eq!(answer, ProviderAnswer::RetryLater, "{label}");
    }
    let mut endpoints = fake.apns_endpoints();
    endpoints.production = "http://127.0.0.1:9".to_string();
    let unreachable = api::push::apns::ApnsSender::with_client(
        api::push::apns::ApnsCredentials {
            key_id: KEY_ID.to_string(),
            team_id: TEAM_ID.to_string(),
            key: api::push::jwt::Es256Key::from_pem(&apns_key().pem).unwrap(),
        },
        endpoints,
        clock(),
        quick_client(Protocol::Http2Only),
    );
    assert_eq!(
        unreachable.send(&registration, &apns_message()).await,
        ProviderAnswer::RetryLater,
        "unreachable"
    );
}

#[tokio::test]
async fn apns_refuses_a_message_built_for_fcm() {
    let fake = FakeProvider::start().await;
    let sender = apns_sender(&fake, clock());
    let answer = sender
        .send(
            &ios(PushEnvironment::Production),
            &PushMessage::Fcm(fcm_body()),
        )
        .await;
    assert_eq!(answer, ProviderAnswer::Rejected);
    assert!(fake.received().is_empty());
}

// ── FCM ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn fcm_assertion_is_an_rs256_jwt_for_googles_token_endpoint() {
    let fake = FakeProvider::start().await;
    let sender = fcm_sender(&fake, clock());
    let jwt = verify_rs256(&sender.assertion());
    assert_eq!(
        jwt.header,
        json!({ "alg": "RS256", "typ": "JWT", "kid": PRIVATE_KEY_ID })
    );
    let iat = start().timestamp();
    assert_eq!(
        jwt.claims,
        json!({
            "iss": CLIENT_EMAIL,
            "scope": FCM_SCOPE,
            "aud": GOOGLE_TOKEN_ENDPOINT,
            "iat": iat,
            "exp": iat + 3600,
        })
    );
    assert_eq!(
        rs256_key().sign(&json!({}), &json!({})).split('.').count(),
        3
    );
}

#[tokio::test]
async fn fcm_request_has_googles_shape() {
    let fake = FakeProvider::start().await;
    let sender = fcm_sender(&fake, clock());
    let answer = sender.send(&android(), &PushMessage::Fcm(fcm_body())).await;
    assert_eq!(answer, ProviderAnswer::Delivered);

    let exchange = &fake.token_requests()[0];
    assert_eq!(exchange.method, "POST");
    assert_eq!(
        exchange.header("content-type"),
        "application/x-www-form-urlencoded"
    );
    let form = exchange
        .body
        .strip_prefix("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=")
        .unwrap();
    verify_rs256(form);

    let sends = fake.sends();
    assert_eq!(sends.len(), 1);
    let sent = &sends[0];
    assert_eq!(sent.method, "POST");
    assert_eq!(sent.path, format!("/v1/projects/{PROJECT}/messages:send"));
    assert_eq!(bearer_of(sent, "Bearer"), ACCESS_TOKEN);
    assert!(sent.header("content-type").starts_with("application/json"));
    let mut expected = fixtures()["payloads"][0]["fcm"].clone();
    expected["message"]["token"] = json!(android_token());
    assert_eq!(sent.json(), expected);
}

#[tokio::test]
async fn fcm_access_token_is_cached_until_shortly_before_it_expires() {
    let fake = FakeProvider::start().await;
    let clock = clock();
    let sender = fcm_sender(&fake, clock.clone());
    let message = PushMessage::Fcm(fcm_body());
    sender.send(&android(), &message).await;
    sender.send(&android(), &message).await;
    assert_eq!(fake.token_requests().len(), 1, "one exchange for two sends");

    // The fake grants 3599 seconds; the token is replaced five minutes before.
    clock.advance(Duration::seconds(3599) - FCM_TOKEN_MARGIN - Duration::seconds(1));
    sender.send(&android(), &message).await;
    assert_eq!(fake.token_requests().len(), 1);
    clock.advance(Duration::seconds(1));
    sender.send(&android(), &message).await;
    assert_eq!(fake.token_requests().len(), 2, "renewed inside the margin");
}

#[tokio::test]
async fn fcm_token_endpoint_failures_reject_or_retry() {
    let fake = FakeProvider::start().await;
    let sender = fcm_sender(&fake, clock());
    let message = PushMessage::Fcm(fcm_body());
    fake.script_tokens([
        Script::json(
            400,
            &json!({ "error": "invalid_grant", "error_description": "SENTINEL_reply" }),
        ),
        Script::json(200, &json!({ "token_type": "Bearer" })),
        Script::Reply(503, String::new()),
        Script::Hang,
    ]);
    for (label, expected) in [
        ("refused", ProviderAnswer::Rejected),
        ("no token in a 200", ProviderAnswer::Rejected),
        ("unavailable", ProviderAnswer::RetryLater),
        ("timeout", ProviderAnswer::RetryLater),
    ] {
        assert_eq!(sender.send(&android(), &message).await, expected, "{label}");
    }
    assert!(fake.sends().is_empty(), "nothing sent without a token");
}

#[tokio::test]
async fn fcm_every_pinned_reply_maps_to_its_answer() {
    let fake = FakeProvider::start().await;
    let sender = fcm_sender(&fake, clock());
    let cases = replies_for("android").await;
    assert!(cases.len() >= 10);
    for (name, status, body, expected) in cases {
        fake.script_sends([Script::Reply(status, body)]);
        let answer = sender.send(&android(), &PushMessage::Fcm(fcm_body())).await;
        assert_eq!(answer, expected, "{name}");
    }
}

#[tokio::test]
async fn fcm_unauthenticated_drops_the_cached_access_token() {
    let fake = FakeProvider::start().await;
    let sender = fcm_sender(&fake, clock());
    let message = PushMessage::Fcm(fcm_body());
    fake.script_sends([Script::json(
        401,
        &json!({ "error": { "code": 401, "status": "UNAUTHENTICATED" } }),
    )]);
    sender.send(&android(), &message).await;
    sender.send(&android(), &message).await;
    assert_eq!(fake.token_requests().len(), 2);
}

#[tokio::test]
async fn fcm_transport_failures_retry_later_and_apns_messages_are_refused() {
    let fake = FakeProvider::start().await;
    let sender = fcm_sender(&fake, clock());
    let message = PushMessage::Fcm(fcm_body());
    fake.script_sends([Script::Hang]);
    assert_eq!(
        sender.send(&android(), &message).await,
        ProviderAnswer::RetryLater
    );
    assert_eq!(
        sender.send(&android(), &apns_message()).await,
        ProviderAnswer::Rejected
    );
}

#[test]
fn fcm_error_reads_the_code_and_whether_the_token_is_named() {
    assert_eq!(fcm_error(b""), FcmError::default());
    assert_eq!(
        fcm_error(br#"{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}"#),
        FcmError {
            code: Some("UNREGISTERED".to_string()),
            names_token: false
        }
    );
    assert_eq!(
        fcm_error(
            br#"{"error":{"status":"INVALID_ARGUMENT","details":[{"fieldViolations":[{"field":"message.token"}]}]}}"#
        ),
        FcmError {
            code: Some("INVALID_ARGUMENT".to_string()),
            names_token: true
        }
    );
}

// ── The client ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn transport_refuses_a_header_it_cannot_send() {
    let fake = FakeProvider::start().await;
    let client = HttpClient::new(Protocol::Negotiated, std::time::Duration::from_secs(5));
    let reply = client
        .post(&fake.url, &[("apns-topic", "bad\nvalue")], Vec::new())
        .await;
    assert!(reply.is_none());
    assert!(fake.received().is_empty());
    let ok = client.post(&fake.url, &[], Vec::new()).await.unwrap();
    assert_eq!(ok.status, 200);
}
