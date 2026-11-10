//! Sending notifications to a user's devices and keeping the registry clean (REQ-PSH-005,
//! REQ-PSH-006, REQ-PSH-007, ADR-0044).
//!
//! [`Push::notify`] builds the payload for each registration of a user that may receive it
//! ([`payload`]), hands it to the [`PushSender`] ([`sender`]) and removes a registration whose
//! token the provider reports dead. What nobody refreshed for `DEVICE_POLICY.stale_after_days` is
//! removed by the database prune (`crate::db::prune`, REQ-DB-009). Registry reads and writes run
//! off the async executor (REQ-DB-008). Log lines carry fixed fields only: never a token, an
//! installation id or a user id.

pub mod apns;
pub mod fcm;
pub mod jwt;
pub mod manual;
pub mod payload;
pub mod providers;
pub mod sender;
pub mod transport;

use std::sync::Arc;

use crate::db::off_runtime;
use crate::devices::{DevicePlatform, DeviceStore, Registration};
use crate::session_store::StoreError;
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
    sender: Arc<dyn PushSender>,
    /// The iOS bundle id, sent as `apns-topic`.
    apns_topic: String,
}

impl Push {
    /// Sends through `sender` to the registry `sessions` keeps.
    pub fn new(sessions: &Sessions, sender: Arc<dyn PushSender>, apns_topic: &str) -> Self {
        Self {
            devices: sessions.devices().clone(),
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

    /// Rings every device of `user_id` that may receive `notification`, about `id`. Fails only
    /// when the registry cannot be read; nothing was sent then.
    pub async fn notify(
        &self,
        user_id: &str,
        notification: &Notification,
        id: &OpaqueId,
    ) -> Result<Delivery, StoreError> {
        let mut delivery = Delivery::default();
        let devices = self.devices.clone();
        let user_id = user_id.to_owned();
        let registrations = off_runtime(move || devices.for_user(&user_id)).await?;
        for registration in registrations {
            if !notification.may_reach(registration.marketing) {
                delivery.skipped += 1;
                continue;
            }
            let message = self.message(&registration, notification, id);
            let platform = registration.platform.as_str();
            match self.sender.send(&registration, &message).await {
                ProviderAnswer::Delivered => delivery.delivered += 1,
                ProviderAnswer::TokenDead => {
                    // Only while it still holds this token: a renewed one stays. A registry that
                    // fails here keeps the registration; the next send finds the token dead again.
                    let devices = self.devices.clone();
                    let (installation, token) = (registration.installation, registration.token);
                    let removed =
                        off_runtime(move || devices.remove_if_token(&installation, &token)).await;
                    delivery.removed += usize::from(removed == Ok(true));
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
        Ok(delivery)
    }

    /// The sample's one notification: "you can vote now", about `id` (REQ-PSH-006).
    pub fn eligibility_reached<'a>(
        &'a self,
        user_id: &'a str,
        id: &'a OpaqueId,
    ) -> impl std::future::Future<Output = Result<Delivery, StoreError>> + 'a {
        self.notify(user_id, &payload::ELIGIBILITY_REACHED, id)
    }
}
