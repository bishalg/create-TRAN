//! The APNs sender (REQ-PSH-005, ADR-0046): token-based HTTP/2 to Apple, switched off until its
//! credentials are set.
//!
//! Protocol, as Apple documents it:
//!
//! - "Sending notification requests to APNs"
//!   (<https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns>):
//!   `POST /3/device/<token>` over HTTP/2 to `api.push.apple.com` (production) or
//!   `api.sandbox.push.apple.com` (development builds), with `authorization: bearer <JWT>`,
//!   `apns-push-type`, `apns-topic` (the bundle id), `apns-collapse-id` and `apns-priority`.
//! - "Establishing a token-based connection to APNs" (see [`super::jwt`]): an ES256 JWT with `kid`,
//!   `iss` and `iat`, refreshed "no more than once every 20 minutes and no less than once every 60
//!   minutes"; one older than an hour is refused (`403 ExpiredProviderToken`), one renewed more
//!   often is refused too (`429 TooManyProviderTokenUpdates`).
//! - "Handling notification responses from APNs"
//!   (<https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns>):
//!   the status and the body's `reason`, mapped by [`apns_answer`].
//!
//! The token appears only in the request path; nothing here logs a path, a token or the JWT.

use std::sync::{Arc, Mutex, PoisonError};

use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};

use super::jwt::Es256Key;
use super::sender::{apns_answer, ProviderAnswer, PushMessage, PushSender, SendFuture};
use super::transport::{HttpClient, Protocol, DEFAULT_TIMEOUT};
use crate::clock::Clock;
use crate::devices::{PushEnvironment, Registration};
use crate::secret::Secret;

/// Apple's two gateways.
pub const APNS_PRODUCTION: &str = "https://api.push.apple.com";
pub const APNS_SANDBOX: &str = "https://api.sandbox.push.apple.com";

/// A provider token is reused until it is this old: inside Apple's 20 to 60 minute window, with
/// ten minutes to spare before the hour after which APNs refuses it.
pub const APNS_TOKEN_REFRESH_AFTER: Duration = Duration::minutes(50);

/// `apns-priority: 10`, deliver now: the doorbell is an alert.
const PRIORITY_NOW: &str = "10";

/// Where the sender posts; [`ApnsEndpoints::apple`] in production, a fake server in tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApnsEndpoints {
    pub production: String,
    pub sandbox: String,
}

impl ApnsEndpoints {
    pub fn apple() -> Self {
        Self {
            production: APNS_PRODUCTION.to_string(),
            sandbox: APNS_SANDBOX.to_string(),
        }
    }
}

/// What APNs needs from the team: the key's id, the team id and the `.p8` key.
#[derive(Debug)]
pub struct ApnsCredentials {
    pub key_id: String,
    pub team_id: String,
    pub key: Es256Key,
}

/// A provider token and when it was minted.
struct CachedToken {
    jwt: Secret,
    issued_at: DateTime<Utc>,
}

pub struct ApnsSender {
    credentials: ApnsCredentials,
    endpoints: ApnsEndpoints,
    client: HttpClient,
    clock: Arc<dyn Clock>,
    token: Mutex<Option<CachedToken>>,
}

impl ApnsSender {
    pub fn new(
        credentials: ApnsCredentials,
        endpoints: ApnsEndpoints,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self::with_client(
            credentials,
            endpoints,
            clock,
            HttpClient::new(Protocol::Http2Only, DEFAULT_TIMEOUT),
        )
    }

    /// As [`new`](Self::new), with a client of the caller's (a shorter timeout in tests).
    pub fn with_client(
        credentials: ApnsCredentials,
        endpoints: ApnsEndpoints,
        clock: Arc<dyn Clock>,
        client: HttpClient,
    ) -> Self {
        Self {
            credentials,
            endpoints,
            client,
            clock,
            token: Mutex::new(None),
        }
    }

    /// The provider token to send with: the cached one while younger than
    /// [`APNS_TOKEN_REFRESH_AFTER`] (and not dated in the future, after the clock moved back),
    /// else a new one.
    pub fn provider_token(&self) -> Secret {
        let now = self.clock.now();
        let mut cached = self.token.lock().unwrap_or_else(PoisonError::into_inner);
        let fresh = cached.as_ref().filter(|token| {
            let age = now - token.issued_at;
            age >= Duration::zero() && age < APNS_TOKEN_REFRESH_AFTER
        });
        if let Some(token) = fresh {
            return token.jwt.clone();
        }
        let header = json!({ "alg": "ES256", "kid": self.credentials.key_id });
        let claims = json!({ "iss": self.credentials.team_id, "iat": now.timestamp() });
        let jwt = Secret::new(self.credentials.key.sign(&header, &claims));
        *cached = Some(CachedToken {
            jwt: jwt.clone(),
            issued_at: now,
        });
        jwt
    }

    /// Drops the cached provider token, after APNs called it expired.
    fn forget_token(&self) {
        *self.token.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    async fn post(
        &self,
        registration: &Registration,
        body: &Value,
        headers: &[(&str, &str)],
    ) -> ProviderAnswer {
        let base = match registration.environment {
            PushEnvironment::Sandbox => &self.endpoints.sandbox,
            PushEnvironment::Production => &self.endpoints.production,
        };
        let url = format!("{base}/3/device/{}", registration.token.expose());
        let bearer = format!("bearer {}", self.provider_token().expose());
        let mut all = vec![
            ("authorization", bearer.as_str()),
            ("apns-priority", PRIORITY_NOW),
        ];
        all.extend_from_slice(headers);
        let Some(reply) = self
            .client
            .post(&url, &all, body.to_string().into_bytes())
            .await
        else {
            tracing::warn!(provider = "apns", "push transport failed; retry later");
            return ProviderAnswer::RetryLater;
        };
        let reason = serde_json::from_slice::<Value>(&reply.body)
            .ok()
            .and_then(|body| body["reason"].as_str().map(str::to_owned));
        if reason.as_deref() == Some("ExpiredProviderToken") {
            self.forget_token();
        }
        let answer = apns_answer(reply.status, reason.as_deref());
        if answer == ProviderAnswer::Rejected {
            // The reason is Apple's fixed vocabulary, never the token.
            let reason = reason.unwrap_or_default();
            tracing::warn!(
                provider = "apns",
                status = reply.status,
                reason,
                "apns refused the push"
            );
        }
        answer
    }
}

impl PushSender for ApnsSender {
    fn send<'a>(
        &'a self,
        registration: &'a Registration,
        message: &'a PushMessage,
    ) -> SendFuture<'a> {
        Box::pin(async move {
            match message {
                PushMessage::Apns(request) => {
                    self.post(registration, &request.body, &request.headers())
                        .await
                }
                PushMessage::Fcm(_) => ProviderAnswer::Rejected,
            }
        })
    }
}
