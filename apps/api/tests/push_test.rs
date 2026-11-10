// Verifies: REQ-PSH-005 REQ-PSH-006
//! Sending through the registry with a fake sender: provider feedback, the marketing filter and
//! the prune by age (`support/devices.rs`). Naming follows the spec's "Verified by" lines:
//! `provider_*`, `prune_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use api::push::payload::{apns_request, fcm_message, Notification, OpaqueId, ELIGIBILITY_REACHED};
use api::push::sender::{ProviderAnswer, PushMessage};
use api::push::Delivery;
use chrono::Duration;
use serde_json::json;
use support::devices::*;

// ── Provider feedback and age (REQ-PSH-005, REQ-PSH-006) ────────────────────

#[tokio::test]
async fn provider_feedback_removes_a_dead_token_and_keeps_the_rest() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let fcm = android_token();
    let third = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    let fourth = "1a2b3c4d-5e6f-4a7b-9c8d-0e1f2a3b4c5d";
    let fourth_token = "c".repeat(64);
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(&api.register(&voter, TABLET, android(&fcm)).await, "tablet");
    assert_no_content(
        &api.register(&voter, third, ios(IOS_TOKEN_2)).await,
        "third",
    );
    assert_no_content(
        &api.register(&voter, fourth, ios(&fourth_token)).await,
        "fourth",
    );
    api.sender.answer(IOS_TOKEN, ProviderAnswer::TokenDead);
    api.sender.answer(IOS_TOKEN_2, ProviderAnswer::RetryLater);
    api.sender.answer(&fourth_token, ProviderAnswer::Rejected);

    let id = OpaqueId::parse("evt_7Hq2-x9").unwrap();
    let delivery = api
        .push()
        .notify("voter-001", &ELIGIBILITY_REACHED, &id)
        .await;
    assert_eq!(
        delivery,
        Delivery {
            delivered: 1,
            removed: 1,
            retry_later: 1,
            rejected: 1,
            not_configured: 0,
            skipped: 0
        }
    );
    let mut left = api.tokens("voter-001");
    left.sort();
    let mut expected = vec![fcm.clone(), IOS_TOKEN_2.to_string(), fourth_token.clone()];
    expected.sort();
    assert_eq!(left, expected, "only the dead token went");

    let sent = api.sender.sent();
    assert_eq!(sent.len(), 4);
    let to = |token: &str| {
        sent.iter()
            .find(|s| s.token == token)
            .unwrap()
            .message
            .clone()
    };
    assert_eq!(
        to(IOS_TOKEN),
        PushMessage::Apns(apns_request(&ELIGIBILITY_REACHED, &id, "ne-NP", TOPIC))
    );
    assert_eq!(
        to(&fcm),
        PushMessage::Fcm(fcm_message(&ELIGIBILITY_REACHED, &id, "hi"))
    );
    assert!(
        sent.iter()
            .all(|s| !serde_json::to_string(&match &s.message {
                PushMessage::Apns(request) => request.body.clone(),
                PushMessage::Fcm(body) => body.clone(),
            })
            .unwrap()
            .contains(&s.token)),
        "no payload carries its token"
    );
    assert_eq!(
        api.push().notify("nobody", &ELIGIBILITY_REACHED, &id).await,
        Delivery::default()
    );
}

#[tokio::test]
async fn provider_not_configured_keeps_the_registration() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    api.sender.answer(IOS_TOKEN, ProviderAnswer::NotConfigured);
    let id = OpaqueId::parse("evt_1").unwrap();
    let delivery = api.push().eligibility_reached("voter-001", &id).await;
    assert_eq!(
        delivery,
        Delivery {
            not_configured: 1,
            ..Delivery::default()
        }
    );
    assert_eq!(api.tokens("voter-001"), [IOS_TOKEN], "never a dead token");
}

#[tokio::test]
async fn provider_feedback_on_marketing_reaches_only_those_who_opted_in() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    let mut opted_in = ios(IOS_TOKEN);
    opted_in["marketing"] = json!(true);
    assert_no_content(&api.register(&voter, PHONE, opted_in).await, "opted in");
    assert_no_content(&api.register(&voter, TABLET, ios(IOS_TOKEN_2)).await, "not");

    let marketing = Notification {
        marketing: true,
        ..ELIGIBILITY_REACHED
    };
    let id = OpaqueId::parse("promo-1").unwrap();
    let delivery = api.push().notify("voter-001", &marketing, &id).await;
    assert_eq!((delivery.delivered, delivery.skipped), (1, 1));
    let sent = api.sender.sent();
    assert_eq!(
        sent.iter().map(|s| s.token.as_str()).collect::<Vec<_>>(),
        [IOS_TOKEN]
    );
}

#[tokio::test]
async fn prune_removes_registrations_not_refreshed_for_sixty_days() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&voter, TABLET, ios(IOS_TOKEN_2)).await,
        "tablet",
    );

    api.clock.advance(Duration::days(59));
    let refreshed = api.sign_in("citizen_voter").await;
    assert_no_content(
        &api.register(&refreshed, TABLET, ios(IOS_TOKEN_2)).await,
        "weekly refresh",
    );
    assert_eq!(api.push().prune_stale(), 0, "59 days is not stale");

    api.clock.advance(Duration::days(1));
    assert_eq!(api.push().prune_stale(), 1, "60 days is");
    assert_eq!(api.tokens("voter-001"), [IOS_TOKEN_2]);
}
