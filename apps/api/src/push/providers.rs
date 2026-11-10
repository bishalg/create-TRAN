//! Which real senders run, from configuration (REQ-PSH-005, ADR-0046).
//!
//! Each provider is on when all its variables are set and parse, and off when none is set. Off is
//! not an error: a send for that platform answers [`ProviderAnswer::NotConfigured`], which never
//! removes a registration, and one `info` line at start-up says which providers are on. A
//! provider half configured, or a key that does not parse, stops start-up with a
//! [`PushConfigError`] naming the variable, never its value.

use std::sync::Arc;

use super::apns::{ApnsCredentials, ApnsEndpoints, ApnsSender};
use super::fcm::{FcmEndpoints, FcmSender, ServiceAccount};
use super::jwt::Es256Key;
use super::sender::{ProviderAnswer, PushMessage, PushSender, SendFuture};
use crate::clock::Clock;
use crate::devices::Registration;
use crate::secret::Secret;

/// The push variables as read from the environment, blank counted as unset.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PushSettings {
    /// `APNS_KEY_ID`: the 10-character id of the APNs auth key.
    pub apns_key_id: Option<String>,
    /// `APNS_TEAM_ID`: the 10-character Apple Developer team id.
    pub apns_team_id: Option<String>,
    /// `APNS_KEY_P8`: the `.p8` key's content.
    pub apns_key_p8: Option<Secret>,
    /// `APNS_TOPIC`: the iOS app's bundle id. No default: it must name the fork's app.
    pub apns_topic: Option<String>,
    /// `FCM_SERVICE_ACCOUNT_JSON`: the whole JSON key of a service account allowed to send.
    pub fcm_service_account_json: Option<Secret>,
}

/// The APNs variables, in the order an error lists them.
pub const APNS_VARIABLES: [&str; 4] = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY_P8", "APNS_TOPIC"];

impl PushSettings {
    /// Reads the variables through `lookup`; blank values are unset.
    pub fn from_lookup(lookup: &impl Fn(&str) -> Option<String>) -> Self {
        // Literal names, so the env contract (`pnpm secrets:check`) sees what is read.
        let set = |value: Option<String>| value.filter(|value| !value.trim().is_empty());
        let word = |value: Option<String>| set(value).map(|v| v.trim().to_string());
        Self {
            apns_key_id: word(lookup("APNS_KEY_ID")),
            apns_team_id: word(lookup("APNS_TEAM_ID")),
            apns_key_p8: set(lookup("APNS_KEY_P8")).map(Secret::new),
            apns_topic: word(lookup("APNS_TOPIC")),
            fcm_service_account_json: set(lookup("FCM_SERVICE_ACCOUNT_JSON")).map(Secret::new),
        }
    }
}

/// Configuration that must stop start-up. The message names variables, never values.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PushConfigError {
    #[error("APNs is partly configured: set {} together (missing: {})", APNS_VARIABLES.join(", "), .0.join(", "))]
    ApnsIncomplete(Vec<&'static str>),
    #[error("APNS_KEY_P8 is not a PKCS#8 P-256 private key (the content of the .p8 file)")]
    ApnsKey,
    #[error("FCM_SERVICE_ACCOUNT_JSON is not a usable service-account key: check its {0}")]
    FcmServiceAccount(&'static str),
}

/// Where the real senders post: the providers in production, a fake server in tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub apns: ApnsEndpoints,
    pub fcm: FcmEndpoints,
}

impl Endpoints {
    pub fn real() -> Self {
        Self {
            apns: ApnsEndpoints::apple(),
            fcm: FcmEndpoints::google(),
        }
    }
}

/// The senders that are on, behind one [`PushSender`] that picks by message.
#[derive(Default)]
pub struct PushProviders {
    apns: Option<ApnsSender>,
    fcm: Option<FcmSender>,
    apns_topic: String,
}

impl PushProviders {
    /// Both providers off: what the API runs with when nothing is configured.
    pub fn off() -> Self {
        Self::default()
    }

    /// The senders `settings` switch on, posting to `endpoints` on `clock`.
    pub fn from_settings(
        settings: &PushSettings,
        endpoints: Endpoints,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, PushConfigError> {
        let apns = apns_credentials(settings)?;
        let fcm = settings
            .fcm_service_account_json
            .as_ref()
            .map(|json| ServiceAccount::from_json(json.expose()))
            .transpose()
            .map_err(PushConfigError::FcmServiceAccount)?;
        Ok(Self {
            apns_topic: settings.apns_topic.clone().unwrap_or_default(),
            apns: apns.map(|c| ApnsSender::new(c, endpoints.apns, clock.clone())),
            fcm: fcm.map(|a| FcmSender::new(a, endpoints.fcm, clock)),
        })
    }

    /// As built from parts, for tests that bring their own senders.
    pub fn from_senders(
        apns: Option<ApnsSender>,
        fcm: Option<FcmSender>,
        apns_topic: &str,
    ) -> Self {
        Self {
            apns,
            fcm,
            apns_topic: apns_topic.to_string(),
        }
    }

    /// The bundle id sent as `apns-topic`; empty while APNs is off.
    pub fn apns_topic(&self) -> &str {
        &self.apns_topic
    }

    /// `("on" | "off", "on" | "off")` for APNs and FCM.
    pub fn state(&self) -> (&'static str, &'static str) {
        let word = |on: bool| if on { "on" } else { "off" };
        (word(self.apns.is_some()), word(self.fcm.is_some()))
    }

    /// The one start-up line: which providers are on. Never a value.
    pub fn log_state(&self) {
        let (apns, fcm) = self.state();
        tracing::info!(apns, fcm, "push providers");
    }
}

fn apns_credentials(settings: &PushSettings) -> Result<Option<ApnsCredentials>, PushConfigError> {
    let present = [
        settings.apns_key_id.is_some(),
        settings.apns_team_id.is_some(),
        settings.apns_key_p8.is_some(),
        settings.apns_topic.is_some(),
    ];
    let missing: Vec<&'static str> = APNS_VARIABLES
        .into_iter()
        .zip(present)
        .filter(|(_, set)| !set)
        .map(|(name, _)| name)
        .collect();
    match (
        &settings.apns_key_id,
        &settings.apns_team_id,
        &settings.apns_key_p8,
    ) {
        _ if missing.len() == APNS_VARIABLES.len() => Ok(None),
        (Some(key_id), Some(team_id), Some(p8)) if missing.is_empty() => {
            let key = Es256Key::from_pem(p8.expose()).ok_or(PushConfigError::ApnsKey)?;
            Ok(Some(ApnsCredentials {
                key_id: key_id.clone(),
                team_id: team_id.clone(),
                key,
            }))
        }
        _ => Err(PushConfigError::ApnsIncomplete(missing)),
    }
}

impl PushSender for PushProviders {
    fn send<'a>(
        &'a self,
        registration: &'a Registration,
        message: &'a PushMessage,
    ) -> SendFuture<'a> {
        let sender: Option<&dyn PushSender> = match message {
            PushMessage::Apns(_) => self.apns.as_ref().map(|s| s as &dyn PushSender),
            PushMessage::Fcm(_) => self.fcm.as_ref().map(|s| s as &dyn PushSender),
        };
        match sender {
            Some(sender) => sender.send(registration, message),
            None => Box::pin(async { ProviderAnswer::NotConfigured }),
        }
    }
}
