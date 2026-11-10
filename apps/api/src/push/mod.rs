//! Sending notifications to a user's devices and keeping the registry clean (REQ-PSH-005,
//! REQ-PSH-006, REQ-PSH-007, ADR-0044).
//!
//! [`Push::notify`] builds the payload for each registration of a user that may receive it
//! ([`payload`]), hands it to the [`PushSender`] ([`sender`]) and removes a registration whose
//! token the provider reports dead. [`Push::prune_stale`] removes what nobody refreshed for
//! `DEVICE_POLICY.stale_after_days`; a fork runs it on a schedule. Log lines carry fixed fields
//! only: never a token, an installation id or a user id.

pub mod apns;
pub mod fcm;
pub mod jwt;
pub mod manual;
pub mod payload;
pub mod providers;
pub mod sender;
pub mod transport;

use std::sync::Arc;

use chrono::Duration;
use rust_core::push::DEVICE_POLICY;

use crate::clock::Clock;
use crate::devices::{DevicePlatform, DeviceStore, Registration};
use crate::sessions::Sessions;
use payload::{apns_request, fcm_message, Notification, OpaqueId};
use sender::{ProviderAnswer, PushMessage, PushSender};

/// What one [`Push::notify`] did, by outcome.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Delivery {
    pub delivered: usize,
    /// Registrations removed because the provider said the token is dead.
    pub removed: usize,
    /// For the caller's job queue to try again.
    pub retry_later: usize,
    pub rejected: usize,
    /// Registrations whose platform has no sender configured (ADR-0046); kept.
    pub not_configured: usize,
    /// Registrations a marketing notification skipped because they did not opt in.
    pub skipped: usize,
}

pub struct Push {
    devices: Arc<dyn DeviceStore>,
    clock: Arc<dyn Clock>,
    sender: Arc<dyn PushSender>,
    /// The iOS bundle id, sent as `apns-topic`.
    apns_topic: String,
}

impl Push {
    /// Sends through `sender` to the registry `sessions` keeps, on its clock.
    pub fn new(sessions: &Sessions, sender: Arc<dyn PushSender>, apns_topic: &str) -> Self {
        Self {
            devices: sessions.devices().clone(),
            clock: sessions.clock().clone(),
            sender,
            apns_topic: apns_topic.to_string(),
        }
    }

    /// The message for one registration, in its platform's format and its locale.
    fn message(&self, registration: &Registration, n: &Notification, id: &OpaqueId) -> PushMessage {
        match registration.platform {
            DevicePlatform::Ios => {
                PushMessage::Apns(apns_request(n, id, &registration.locale, &self.apns_topic))
            }
            DevicePlatform::Android => PushMessage::Fcm(fcm_message(n, id, &registration.locale)),
        }
    }

    /// Rings every device of `user_id` that may receive `notification`, about `id`.
    pub async fn notify(
        &self,
        user_id: &str,
        notification: &Notification,
        id: &OpaqueId,
    ) -> Delivery {
        let mut delivery = Delivery::default();
        for registration in self.devices.for_user(user_id) {
            if !notification.may_reach(registration.marketing) {
                delivery.skipped += 1;
                continue;
            }
            let message = self.message(&registration, notification, id);
            let platform = registration.platform.as_str();
            match self.sender.send(&registration, &message).await {
                ProviderAnswer::Delivered => delivery.delivered += 1,
                ProviderAnswer::TokenDead => {
                    // Only while it still holds this token: a renewed one stays.
                    delivery.removed += usize::from(
                        self.devices
                            .remove_if_token(&registration.installation, &registration.token),
                    );
                    tracing::info!(platform, "push token dead; registration removed");
                }
                ProviderAnswer::RetryLater => delivery.retry_later += 1,
                ProviderAnswer::Rejected => {
                    delivery.rejected += 1;
                    tracing::warn!(platform, "push rejected by the provider");
                }
                // Said once at start-up (`PushProviders::log_state`), not per send.
                ProviderAnswer::NotConfigured => delivery.not_configured += 1,
            }
        }
        delivery
    }

    /// The sample's one notification: "you can vote now", about `id` (REQ-PSH-006).
    pub fn eligibility_reached<'a>(
        &'a self,
        user_id: &'a str,
        id: &'a OpaqueId,
    ) -> impl std::future::Future<Output = Delivery> + 'a {
        self.notify(user_id, &payload::ELIGIBILITY_REACHED, id)
    }

    /// Removes every registration not refreshed for `DEVICE_POLICY.stale_after_days`; returns
    /// how many (REQ-PSH-005).
    pub fn prune_stale(&self) -> usize {
        let cutoff = self.clock.now() - Duration::seconds(DEVICE_POLICY.stale_after_seconds());
        let removed = self.devices.prune(cutoff);
        tracing::info!(removed, "stale device registrations pruned");
        removed
    }
}
