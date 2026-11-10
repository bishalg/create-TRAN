//! The seam to APNs and FCM (REQ-PSH-005, ADR-0044 decision 8).
//!
//! [`PushSender`] sends one built message to one registration and reports a [`ProviderAnswer`].
//! [`FakeSender`] is what the registry tests use. The real senders, [`super::apns::ApnsSender`]
//! (HTTP/2 with a `.p8` provider token) and [`super::fcm::FcmSender`] (FCM v1 with a service
//! account), sit behind this trait in [`super::providers::PushProviders`], switched off until
//! their credentials are set (ADR-0046); each maps its provider's reply with [`apns_answer`] or
//! [`fcm_answer`], which are tested here and against a fake provider, so the feedback handling
//! they rely on is proven without credentials.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Mutex, PoisonError};

use serde_json::Value;

use super::payload::ApnsRequest;
use crate::devices::{DevicePlatform, Registration};

/// What a provider said about one send, in one vocabulary for both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderAnswer {
    /// Accepted for delivery.
    Delivered,
    /// The token is unregistered or invalid: the registration is removed (REQ-PSH-005).
    TokenDead,
    /// Throttled or the provider failed: the caller's job queue tries again later.
    RetryLater,
    /// Refused for another reason (a payload or credential problem): logged, the token kept.
    Rejected,
    /// No sender for this platform is configured (ADR-0046). Not a provider's reply: logged once
    /// at start-up, never per send, and never a reason to remove a registration.
    NotConfigured,
}

/// Maps an APNs reply: `200`; `410 Unregistered`; `400 BadDeviceToken` or
/// `DeviceTokenNotForTopic`; `429` and `5xx`; anything else.
pub fn apns_answer(status: u16, reason: Option<&str>) -> ProviderAnswer {
    match (status, reason) {
        (200, _) => ProviderAnswer::Delivered,
        (410, _) | (400, Some("BadDeviceToken" | "DeviceTokenNotForTopic")) => {
            ProviderAnswer::TokenDead
        }
        (429 | 500..=599, _) => ProviderAnswer::RetryLater,
        _ => ProviderAnswer::Rejected,
    }
}

/// Maps an FCM v1 reply by its `error.status` (or `details[].errorCode`): `UNREGISTERED` is a
/// dead token, and so is `INVALID_ARGUMENT` when the error names `message.token`
/// (`names_token`); any other `INVALID_ARGUMENT` is a payload problem and must not remove a
/// registration. `UNAVAILABLE`, `INTERNAL`, `QUOTA_EXCEEDED`, `429` and `5xx` retry later.
pub fn fcm_answer(status: u16, error: Option<&str>, names_token: bool) -> ProviderAnswer {
    match (status, error) {
        (200, _) => ProviderAnswer::Delivered,
        (_, Some("UNREGISTERED")) => ProviderAnswer::TokenDead,
        (_, Some("INVALID_ARGUMENT")) if names_token => ProviderAnswer::TokenDead,
        (_, Some("UNAVAILABLE" | "INTERNAL" | "QUOTA_EXCEEDED")) | (429 | 500..=599, _) => {
            ProviderAnswer::RetryLater
        }
        _ => ProviderAnswer::Rejected,
    }
}

/// A message built for one platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PushMessage {
    /// Headers and body for `POST /3/device/{token}`.
    Apns(ApnsRequest),
    /// The `messages:send` body, without `message.token`.
    Fcm(Value),
}

/// A send in flight.
pub type SendFuture<'a> = Pin<Box<dyn Future<Output = ProviderAnswer> + Send + 'a>>;

pub trait PushSender: Send + Sync {
    /// Sends `message` to `registration`'s token (in its APNs environment) and reports the answer.
    /// A transport failure is [`ProviderAnswer::RetryLater`]. Never logs the token.
    fn send<'a>(
        &'a self,
        registration: &'a Registration,
        message: &'a PushMessage,
    ) -> SendFuture<'a>;
}

/// One message the fake was asked to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sent {
    pub platform: DevicePlatform,
    /// The token it was addressed to, so a test can tell devices apart.
    pub token: String,
    pub message: PushMessage,
}

/// A sender that records every message and answers what the test scripted per token
/// ([`ProviderAnswer::Delivered`] by default).
#[derive(Debug, Default)]
pub struct FakeSender {
    answers: Mutex<HashMap<String, ProviderAnswer>>,
    sent: Mutex<Vec<Sent>>,
}

impl FakeSender {
    /// From now on, sends to `token` get `answer`.
    pub fn answer(&self, token: &str, answer: ProviderAnswer) {
        self.answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(token.to_string(), answer);
    }

    /// Everything sent so far, in order.
    pub fn sent(&self) -> Vec<Sent> {
        self.sent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl PushSender for FakeSender {
    fn send<'a>(
        &'a self,
        registration: &'a Registration,
        message: &'a PushMessage,
    ) -> SendFuture<'a> {
        let token = registration.token.expose().to_string();
        let answer = self
            .answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&token)
            .copied()
            .unwrap_or(ProviderAnswer::Delivered);
        self.sent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Sent {
                platform: registration.platform,
                token,
                message: message.clone(),
            });
        Box::pin(async move { answer })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-PSH-005
    #[test]
    fn apns_replies_map_onto_the_four_answers() {
        use ProviderAnswer::*;
        for (status, reason, answer) in [
            (200, None, Delivered),
            (410, Some("Unregistered"), TokenDead),
            (400, Some("BadDeviceToken"), TokenDead),
            (400, Some("DeviceTokenNotForTopic"), TokenDead),
            (400, Some("PayloadTooLarge"), Rejected),
            (403, Some("InvalidProviderToken"), Rejected),
            (429, Some("TooManyRequests"), RetryLater),
            (500, None, RetryLater),
            (503, Some("ServiceUnavailable"), RetryLater),
        ] {
            assert_eq!(apns_answer(status, reason), answer, "{status} {reason:?}");
        }
    }

    // Verifies: REQ-PSH-005
    #[test]
    fn fcm_replies_map_onto_the_four_answers() {
        use ProviderAnswer::*;
        for (status, error, names_token, answer) in [
            (200, None, false, Delivered),
            (404, Some("UNREGISTERED"), false, TokenDead),
            (400, Some("INVALID_ARGUMENT"), true, TokenDead),
            (400, Some("INVALID_ARGUMENT"), false, Rejected),
            (403, Some("SENDER_ID_MISMATCH"), false, Rejected),
            (429, Some("QUOTA_EXCEEDED"), false, RetryLater),
            (503, Some("UNAVAILABLE"), false, RetryLater),
            (500, Some("INTERNAL"), false, RetryLater),
            (502, None, false, RetryLater),
        ] {
            assert_eq!(
                fcm_answer(status, error, names_token),
                answer,
                "{status} {error:?}"
            );
        }
    }
}
