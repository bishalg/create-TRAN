// Verifies: REQ-PSH-005
//! The two sends only real credentials can prove (ADR-0046, docs/CREDENTIALS.md): a notification
//! accepted by APNs and by FCM for a real device. They read everything from the environment, so
//! setting the variables and deleting the `#[ignore]` line is the whole enabling step. Run one
//! with `cargo test -p api --test push_live_test -- --ignored`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use api::clock::SystemClock;
use api::config::AppConfig;
use api::push::manual;
use api::push::providers::Endpoints;
use api::push::sender::ProviderAnswer;

/// Sends the sample's doorbell to the device in `token_variable`, through the real provider.
async fn send_for_real(platform: &str, environment: &str, token_variable: &str) -> ProviderAnswer {
    let config = AppConfig::from_env();
    let token = std::env::var(token_variable).expect(token_variable);
    let args: Vec<String> = [
        "--platform",
        platform,
        "--environment",
        environment,
        "--token",
        &token,
        "--id",
        "live-test",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .collect();
    manual::run(
        &args,
        &config.push,
        Endpoints::real(),
        Arc::new(SystemClock),
    )
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "TODO(credentials): APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8, APNS_TOPIC, APNS_TEST_DEVICE_TOKEN - a real notification is accepted by APNs"]
async fn apns_live_send_is_accepted_by_apple() {
    // The token of a development build (Xcode run) belongs to the sandbox gateway.
    let answer = send_for_real("ios", "sandbox", "APNS_TEST_DEVICE_TOKEN").await;
    assert_eq!(answer, ProviderAnswer::Delivered);
}

#[tokio::test]
#[ignore = "TODO(credentials): FCM_SERVICE_ACCOUNT_JSON, FCM_TEST_DEVICE_TOKEN - a real notification is accepted by FCM"]
async fn fcm_live_send_is_accepted_by_google() {
    let answer = send_for_real("android", "production", "FCM_TEST_DEVICE_TOKEN").await;
    assert_eq!(answer, ProviderAnswer::Delivered);
}
