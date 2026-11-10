//! Ringing one device by hand, to check a provider's configuration (REQ-PSH-005, ADR-0046).
//!
//! `cargo run -p api -- send-test-push --platform ios --environment sandbox --token <hex>` sends
//! the sample's doorbell (`eligibility.reached`) to that token through the configured sender and
//! reports the provider's answer. There is no public route for it: sending is an operator's act.
//! The command addresses a token, not a user, so it works without the server's database; code inside the API rings a user with [`super::Push::eligibility_reached`].

use std::sync::Arc;

use chrono::DateTime;

use super::payload::{apns_request, fcm_message, OpaqueId, ELIGIBILITY_REACHED};
use super::providers::{Endpoints, PushProviders, PushSettings};
use super::sender::{ProviderAnswer, PushMessage, PushSender};
use crate::clock::Clock;
use crate::devices::{DevicePlatform, InstallationId, PushEnvironment, PushToken, Registration};
use crate::session_store::SessionId;

/// The subcommand's name.
pub const COMMAND: &str = "send-test-push";

/// How to call it, for an error message.
pub const USAGE: &str = "usage: api send-test-push --platform ios|android --token <token> \
[--environment sandbox|production] [--locale <tag>] [--id <opaque id>]";

/// One hand-made send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManualSend {
    pub platform: DevicePlatform,
    pub environment: PushEnvironment,
    pub token: PushToken,
    pub locale: String,
    pub id: OpaqueId,
}

/// Reads the arguments after the subcommand. The error names the flag, never the token.
pub fn parse(args: &[String]) -> Result<ManualSend, String> {
    let flag = |name: &str| {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|at| args.get(at + 1))
            .map(String::as_str)
    };
    let platform = match flag("--platform") {
        Some("ios") => DevicePlatform::Ios,
        Some("android") => DevicePlatform::Android,
        _ => return Err(format!("--platform must be ios or android; {USAGE}")),
    };
    let environment = match (platform, flag("--environment")) {
        (DevicePlatform::Android, _) | (_, Some("production")) => PushEnvironment::Production,
        (_, None | Some("sandbox")) => PushEnvironment::Sandbox,
        _ => {
            return Err(format!(
                "--environment must be sandbox or production; {USAGE}"
            ))
        }
    };
    let token = flag("--token")
        .and_then(|raw| PushToken::parse(platform, raw))
        .ok_or_else(|| {
            format!(
                "--token is missing or not a {} token; {USAGE}",
                platform.as_str()
            )
        })?;
    let id = OpaqueId::parse(flag("--id").unwrap_or("manual-test"))
        .ok_or_else(|| format!("--id must be 1-64 of [A-Za-z0-9_-]; {USAGE}"))?;
    Ok(ManualSend {
        platform,
        environment,
        token,
        locale: flag("--locale").unwrap_or("en").to_string(),
        id,
    })
}

/// Sends `send`'s doorbell through `providers`.
pub async fn send(providers: &PushProviders, send: &ManualSend) -> ProviderAnswer {
    let registration = Registration {
        installation: InstallationId::random(),
        user_id: String::new(),
        session: SessionId(0),
        platform: send.platform,
        environment: send.environment,
        token: send.token.clone(),
        locale: send.locale.clone(),
        app_version: "0".to_string(),
        marketing: false,
        refreshed_at: DateTime::UNIX_EPOCH,
    };
    let message = match send.platform {
        DevicePlatform::Ios => PushMessage::Apns(apns_request(
            &ELIGIBILITY_REACHED,
            &send.id,
            &send.locale,
            providers.apns_topic(),
        )),
        DevicePlatform::Android => {
            PushMessage::Fcm(fcm_message(&ELIGIBILITY_REACHED, &send.id, &send.locale))
        }
    };
    providers.send(&registration, &message).await
}

/// The whole subcommand: parse, configure, send. `Err` for bad arguments or configuration.
pub async fn run(
    args: &[String],
    settings: &PushSettings,
    endpoints: Endpoints,
    clock: Arc<dyn Clock>,
) -> Result<ProviderAnswer, String> {
    let request = parse(args)?;
    let providers = PushProviders::from_settings(settings, endpoints, clock)
        .map_err(|error| error.to_string())?;
    providers.log_state();
    Ok(send(&providers, &request).await)
}
