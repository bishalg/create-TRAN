// Verifies: REQ-PSH-005 REQ-PSH-007
//! Which senders run (ADR-0046): configuration on, off, half set or malformed; the one start-up
//! line; a dead token removed end to end through `Push::notify` and the real APNs sender; a
//! provider that is off never removing anything; nothing secret in a log, an error or a `Debug`;
//! and the hand-made test send. Naming follows the spec's "Verified by" lines: `provider_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;

use api::config::AppConfig;
use api::push::jwt::{pkcs8_der, Es256Key, Rs256Key};
use api::push::manual::{self, ManualSend};
use api::push::payload::OpaqueId;
use api::push::providers::{Endpoints, PushConfigError, PushProviders, PushSettings};
use api::push::sender::ProviderAnswer;
use api::push::Delivery;
use serde_json::json;
use support::devices::{
    android, android_token, assert_no_content, ios, Api, IOS_TOKEN, PHONE, TABLET, TOPIC,
};
use support::providers::*;
use support::Captured;

fn settings(pairs: &[(&str, &str)]) -> PushSettings {
    let pairs: Vec<(String, String)> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    PushSettings::from_lookup(&|key: &str| {
        pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    })
}

fn apns_vars() -> Vec<(&'static str, String)> {
    vec![
        ("APNS_KEY_ID", KEY_ID.to_string()),
        ("APNS_TEAM_ID", TEAM_ID.to_string()),
        // One line, as an environment variable holds it.
        ("APNS_KEY_P8", apns_key().pem.replace('\n', "\\n")),
        ("APNS_TOPIC", TOPIC.to_string()),
    ]
}

fn all_vars() -> Vec<(&'static str, String)> {
    let mut vars = apns_vars();
    vars.push(("FCM_SERVICE_ACCOUNT_JSON", service_account_json()));
    vars
}

fn borrowed<'a>(vars: &'a [(&'static str, String)]) -> Vec<(&'static str, &'a str)> {
    vars.iter().map(|(k, v)| (*k, v.as_str())).collect()
}

fn fake_endpoints(fake: &FakeProvider) -> Endpoints {
    Endpoints {
        apns: fake.apns_endpoints(),
        fcm: fake.fcm_endpoints(),
    }
}

fn clock() -> Arc<api::clock::ManualClock> {
    Arc::new(api::clock::ManualClock::starting_at(start()))
}

#[test]
fn provider_settings_count_blank_as_unset() {
    let blank = settings(&[("APNS_KEY_ID", " "), ("FCM_SERVICE_ACCOUNT_JSON", "")]);
    assert_eq!(blank, PushSettings::default());
    let config =
        AppConfig::from_lookup(|key| (key == "APNS_TOPIC").then(|| " com.x.y ".to_string()));
    assert_eq!(config.push.apns_topic.as_deref(), Some("com.x.y"));
    assert_eq!(
        format!("{:?}", settings(&borrowed(&all_vars())))
            .matches("[redacted]")
            .count(),
        2
    );
}

#[tokio::test]
async fn provider_off_answers_not_configured_and_keeps_every_registration() {
    let providers =
        PushProviders::from_settings(&PushSettings::default(), Endpoints::real(), clock()).unwrap();
    assert_eq!(providers.state(), ("off", "off"));
    assert_eq!(PushProviders::off().state(), ("off", "off"));

    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&voter, TABLET, android(&android_token()))
            .await,
        "tablet",
    );
    // The state's own push, as the API would use it: nothing configured.
    let delivery = api
        .state
        .push()
        .eligibility_reached("voter-001", &OpaqueId::parse("e1").unwrap())
        .await
        .unwrap();
    assert_eq!(
        delivery,
        Delivery {
            not_configured: 2,
            ..Delivery::default()
        }
    );
    assert_eq!(api.tokens("voter-001").len(), 2, "nothing removed");
}

#[tokio::test]
async fn provider_dead_token_from_apns_removes_the_registration_end_to_end() {
    let fake = FakeProvider::start().await;
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&voter, TABLET, android(&android_token()))
            .await,
        "tablet",
    );
    fake.script_sends([Script::json(
        410,
        &json!({ "reason": "Unregistered", "timestamp": 1 }),
    )]);

    // APNs on, FCM off: the iPhone's token is dead, the Android registration is kept.
    let vars = apns_vars();
    let providers =
        PushProviders::from_settings(&settings(&borrowed(&vars)), fake_endpoints(&fake), clock())
            .unwrap();
    assert_eq!(providers.state(), ("on", "off"));
    assert_eq!(providers.apns_topic(), TOPIC);
    let push = api::push::Push::new(&api.state.sessions, Arc::new(providers), TOPIC);
    let delivery = push
        .eligibility_reached("voter-001", &OpaqueId::parse("e1").unwrap())
        .await
        .unwrap();
    assert_eq!(
        delivery,
        Delivery {
            removed: 1,
            not_configured: 1,
            ..Delivery::default()
        }
    );
    assert_eq!(fake.sends().len(), 1);
    assert_eq!(api.tokens("voter-001"), [android_token()]);
}

#[test]
fn provider_configuration_half_set_or_malformed_names_the_variable_not_the_value() {
    let vars = apns_vars();
    let half = settings(&borrowed(&vars[..2]));
    let error = PushProviders::from_settings(&half, Endpoints::real(), clock())
        .err()
        .unwrap();
    assert_eq!(
        error,
        PushConfigError::ApnsIncomplete(vec!["APNS_KEY_P8", "APNS_TOPIC"])
    );
    assert_eq!(
        error.to_string(),
        "APNs is partly configured: set APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8, APNS_TOPIC together (missing: APNS_KEY_P8, APNS_TOPIC)"
    );
    let topic_only = settings(&[("APNS_TOPIC", TOPIC)]);
    assert!(matches!(
        PushProviders::from_settings(&topic_only, Endpoints::real(), clock()),
        Err(PushConfigError::ApnsIncomplete(missing)) if missing.len() == 3
    ));

    let mut bad_key = apns_vars();
    bad_key[2].1 = "SENTINEL-not-a-key".to_string();
    let error =
        PushProviders::from_settings(&settings(&borrowed(&bad_key)), Endpoints::real(), clock())
            .err()
            .unwrap();
    assert_eq!(error, PushConfigError::ApnsKey);
    assert!(error.to_string().starts_with("APNS_KEY_P8 "));

    let account: serde_json::Value = serde_json::from_str(&service_account_json()).unwrap();
    for (field, broken) in [
        ("the JSON", "SENTINEL{".to_string()),
        ("private_key", {
            let mut a = account.clone();
            a["private_key"] = json!("SENTINEL");
            a.to_string()
        }),
        ("private_key", {
            let mut a = account.clone();
            a.as_object_mut().unwrap().remove("private_key");
            a.to_string()
        }),
        ("project_id", {
            let mut a = account.clone();
            a["project_id"] = json!("");
            a.to_string()
        }),
        ("client_email", {
            let mut a = account.clone();
            a.as_object_mut().unwrap().remove("client_email");
            a.to_string()
        }),
        ("private_key_id", {
            let mut a = account.clone();
            a["private_key_id"] = json!(7);
            a.to_string()
        }),
    ] {
        let error = PushProviders::from_settings(
            &settings(&[("FCM_SERVICE_ACCOUNT_JSON", &broken)]),
            Endpoints::real(),
            clock(),
        )
        .err()
        .unwrap();
        assert_eq!(error, PushConfigError::FcmServiceAccount(field), "{field}");
        let message = error.to_string();
        assert!(
            message.starts_with("FCM_SERVICE_ACCOUNT_JSON "),
            "{message}"
        );
        assert!(!message.contains("SENTINEL"), "{message}");
    }
}

#[tokio::test]
async fn provider_misconfiguration_stops_the_server_from_starting() {
    let config = AppConfig::from_lookup(|key| match key {
        "HOST" => Some("127.0.0.1".to_string()),
        "PORT" => Some("0".to_string()),
        "APNS_TOPIC" => Some(TOPIC.to_string()),
        _ => None,
    });
    let error = api::run_server(config).await.err().unwrap();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
    assert!(error.to_string().contains("APNS_KEY_ID"), "{error}");
}

#[test]
fn provider_keys_parse_only_from_pkcs8_pem() {
    assert!(pkcs8_der("no markers").is_none());
    // Markers spelled in parts so the secret scan does not take these samples for keys.
    let (begin, end) = (
        concat!("-----BEGIN ", "PRIVATE KEY-----"),
        concat!("-----END ", "PRIVATE KEY-----"),
    );
    assert!(pkcs8_der(&format!("{begin}\nabc")).is_none());
    assert!(pkcs8_der(&format!("{begin}\n!!!\n{end}")).is_none());
    assert!(
        Es256Key::from_pem(&google_key().pem).is_none(),
        "an RSA key is not a P-256 key"
    );
    assert!(
        Rs256Key::from_pem(&apns_key().pem).is_none(),
        "and the other way round"
    );
    let key = Es256Key::from_pem(&apns_key().pem).unwrap();
    assert_eq!(key.public_key(), apns_key().public.as_slice());
    assert_eq!(
        format!("{key:?} {:?}", rs256_key()),
        "[redacted] [redacted]"
    );
}

#[tokio::test]
async fn provider_logs_say_on_or_off_and_never_a_secret() {
    let fake = FakeProvider::start().await;
    let (captured, _guard) = Captured::install();
    let vars = all_vars();
    let providers =
        PushProviders::from_settings(&settings(&borrowed(&vars)), fake_endpoints(&fake), clock())
            .unwrap();
    providers.log_state();
    PushProviders::off().log_state();
    let lines = captured.named("push providers");
    assert_eq!(lines.len(), 2);
    assert_eq!(
        (lines[0].field("apns"), lines[0].field("fcm")),
        (Some("on"), Some("on"))
    );
    assert_eq!(
        (lines[1].field("apns"), lines[1].field("fcm")),
        (Some("off"), Some("off"))
    );

    // Every refusal and failure, each logged; then nothing secret anywhere in the log.
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    assert_no_content(
        &api.register(&voter, TABLET, android(&android_token()))
            .await,
        "tablet",
    );
    // The same senders with a short timeout, so the hanging provider costs little.
    let quick = PushProviders::from_senders(
        Some(apns_sender(&fake, clock())),
        Some(fcm_sender(&fake, clock())),
        TOPIC,
    );
    assert_eq!(quick.state(), providers.state());
    let push = api::push::Push::new(&api.state.sessions, Arc::new(quick), TOPIC);
    let id = OpaqueId::parse("e1").unwrap();
    // One body both providers can read, whichever device is sent to first.
    let refusal = json!({
        "reason": "InvalidProviderToken",
        "error": { "status": "PERMISSION_DENIED", "message": "SENTINEL_reply" }
    })
    .to_string();
    for status in [403, 400] {
        fake.script_sends([
            Script::Reply(status, refusal.clone()),
            Script::Reply(status, refusal.clone()),
        ]);
        push.eligibility_reached("voter-001", &id).await.unwrap();
    }
    fake.script_sends([Script::Hang, Script::Hang]);
    push.eligibility_reached("voter-001", &id).await.unwrap();
    // A 401 makes FCM drop its access token, so the next send asks Google again, and is refused.
    fake.script_sends([
        Script::Reply(401, String::new()),
        Script::Reply(401, String::new()),
    ]);
    push.eligibility_reached("voter-001", &id).await.unwrap();
    fake.script_tokens([Script::json(
        400,
        &json!({ "error": "invalid_grant", "error_description": "SENTINEL_reply" }),
    )]);
    push.eligibility_reached("voter-001", &id).await.unwrap();

    let events = captured.events();
    for name in [
        "apns refused the push",
        "fcm refused the push",
        "push transport failed; retry later",
    ] {
        assert!(events.iter().any(|e| e.message == name), "{name}");
    }
    assert!(
        captured
            .named("google refused the access token request")
            .len()
            == 1
    );
    let refused = captured.named("apns refused the push");
    assert_eq!(refused[0].field("reason"), Some("InvalidProviderToken"));
    let mut secrets = vec![
        IOS_TOKEN.to_string(),
        android_token(),
        ACCESS_TOKEN.to_string(),
        "SENTINEL".to_string(),
        "PRIVATE KEY".to_string(),
        "eyJ".to_string(), // the start of any JWT
    ];
    secrets.extend(
        fake.sends()
            .iter()
            .map(|s| s.header("authorization").to_string()),
    );
    for event in &events {
        let line = event.line();
        for secret in &secrets {
            assert!(!line.contains(secret.as_str()), "{line} leaks {secret}");
        }
    }
}

#[tokio::test]
async fn provider_manual_send_rings_one_token_through_the_configured_sender() {
    let fake = FakeProvider::start().await;
    let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let vars = all_vars();
    let configured = settings(&borrowed(&vars));

    let ios_send = args(&["--platform", "ios", "--token", IOS_TOKEN, "--locale", "ne"]);
    let answer = manual::run(&ios_send, &configured, fake_endpoints(&fake), clock()).await;
    assert_eq!(answer, Ok(ProviderAnswer::Delivered));
    let sent = &fake.sends()[0];
    assert!(
        sent.path.starts_with("/sandbox/3/device/"),
        "sandbox by default"
    );
    assert_eq!(sent.json()["type"], "eligibility.reached");
    assert_eq!(sent.json()["id"], "manual-test");
    assert_eq!(sent.header("apns-topic"), TOPIC);

    let android_send = args(&[
        "--platform",
        "android",
        "--token",
        &android_token(),
        "--id",
        "evt-1",
    ]);
    let answer = manual::run(&android_send, &configured, fake_endpoints(&fake), clock()).await;
    assert_eq!(answer, Ok(ProviderAnswer::Delivered));
    assert_eq!(fake.sends()[1].json()["message"]["data"]["id"], "evt-1");

    let off = manual::run(
        &ios_send,
        &PushSettings::default(),
        fake_endpoints(&fake),
        clock(),
    )
    .await;
    assert_eq!(off, Ok(ProviderAnswer::NotConfigured));
    let no_args = manual::run(&[], &configured, fake_endpoints(&fake), clock()).await;
    assert!(no_args.unwrap_err().starts_with("--platform"));
    let broken = settings(&[("APNS_TOPIC", TOPIC)]);
    let error = manual::run(&ios_send, &broken, fake_endpoints(&fake), clock())
        .await
        .unwrap_err();
    assert!(error.contains("APNS_KEY_ID"), "{error}");
}

#[test]
fn provider_manual_send_arguments_are_checked_and_never_echo_the_token() {
    let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let parsed = manual::parse(&args(&[
        "--platform",
        "ios",
        "--environment",
        "production",
        "--token",
        IOS_TOKEN,
    ]))
    .unwrap();
    assert_eq!(
        parsed.environment,
        api::devices::PushEnvironment::Production
    );
    assert_eq!(parsed.locale, "en");
    let android: ManualSend = manual::parse(&args(&[
        "--platform",
        "android",
        "--environment",
        "sandbox",
        "--token",
        &android_token(),
    ]))
    .unwrap();
    assert_eq!(
        android.environment,
        api::devices::PushEnvironment::Production,
        "FCM has one"
    );
    for (bad, flag) in [
        (args(&[]), "--platform"),
        (args(&["--platform", "web"]), "--platform"),
        (
            args(&["--platform", "ios", "--environment", "staging"]),
            "--environment",
        ),
        (
            args(&["--platform", "ios", "--token", "SENTINEL"]),
            "--token",
        ),
        (
            args(&["--platform", "ios", "--token", IOS_TOKEN, "--id", "a b"]),
            "--id",
        ),
    ] {
        let error = manual::parse(&bad).unwrap_err();
        assert!(error.starts_with(flag), "{error}");
        assert!(error.contains(manual::USAGE));
        assert!(!error.contains("SENTINEL"));
    }
    assert_eq!(manual::COMMAND, "send-test-push");
}
