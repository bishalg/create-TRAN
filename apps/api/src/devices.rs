//! The device registry (REQ-PSH-001 to REQ-PSH-005, ADR-0044): what one registration is, how its
//! parts are validated, and the [`DeviceStore`] it lives in.
//!
//! A registration binds one installation and its current push token to the signed-in user and the
//! session it was made in. The installation id and the token are never logged or echoed
//! (REQ-PSH-007): both print `[redacted]`, and neither is `Serialize`.

use std::fmt;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::{Uuid, Variant, Version};

use crate::secret::{Secret, REDACTED};
use crate::session_store::SessionId;

/// The random id one install of the app creates on first launch (REQ-PSH-010): a version-4 UUID
/// in its hyphenated form, either case, held lowercase.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct InstallationId(Uuid);

impl InstallationId {
    /// `None` for anything but a hyphenated random (version 4, RFC 4122) UUID.
    pub fn parse(raw: &str) -> Option<Self> {
        let uuid = Uuid::try_parse(raw).ok().filter(|_| raw.len() == 36)?;
        (uuid.get_version() == Some(Version::Random) && uuid.get_variant() == Variant::RFC4122)
            .then_some(Self(uuid))
    }

    /// A new random id, for a send made by hand with no app behind it (`push::manual`).
    pub fn random() -> Self {
        Self(Uuid::new_v4())
    }
}

impl fmt::Debug for InstallationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// The platform's push service a registration is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DevicePlatform {
    /// APNs.
    Ios,
    /// FCM.
    Android,
}

impl DevicePlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ios => "ios",
            Self::Android => "android",
        }
    }
}

/// Which APNs gateway the token belongs to. FCM has one, so Android is always `production`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushEnvironment {
    /// A development build: `api.sandbox.push.apple.com`.
    Sandbox,
    /// A TestFlight or App Store build, and every Android build.
    Production,
}

impl PushEnvironment {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sandbox => "sandbox",
            Self::Production => "production",
        }
    }
}

/// The address a push service gave one installation: not a credential, but it reaches a device,
/// so it is held like one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushToken(Secret);

/// Bounds of a token on each platform. APNs tokens are hex (32 bytes today; Apple may lengthen
/// them); FCM tokens are opaque URL-safe text of no documented length.
const APNS_HEX_CHARS: std::ops::RangeInclusive<usize> = 64..=200;
const FCM_CHARS: std::ops::RangeInclusive<usize> = 32..=1024;

impl PushToken {
    /// `None` unless `raw` is a plausible token for `platform`: even-length hex within
    /// [`APNS_HEX_CHARS`] for iOS (held lowercase), `[A-Za-z0-9_:-]` within [`FCM_CHARS`] for
    /// Android.
    pub fn parse(platform: DevicePlatform, raw: &str) -> Option<Self> {
        let valid = match platform {
            DevicePlatform::Ios => {
                APNS_HEX_CHARS.contains(&raw.len())
                    && raw.len().is_multiple_of(2)
                    && raw.bytes().all(|b| b.is_ascii_hexdigit())
            }
            DevicePlatform::Android => {
                FCM_CHARS.contains(&raw.len())
                    && raw
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'-'))
            }
        };
        // APNs tokens are case-insensitive hex, so one device has one spelling; FCM tokens are
        // case-sensitive and kept as given.
        let spelled = match platform {
            DevicePlatform::Ios => raw.to_ascii_lowercase(),
            DevicePlatform::Android => raw.to_string(),
        };
        valid.then(|| Self(Secret::new(spelled)))
    }

    /// The token itself, for the sender that addresses the push and nothing else.
    pub fn expose(&self) -> &str {
        self.0.expose()
    }
}

/// A BCP 47 language tag such as `en`, `ne-NP` or `zh-Hant-TW`: a 2–3 letter language, then up
/// to three subtags of 1–8 letters or digits, at most 35 characters.
pub fn is_locale_tag(raw: &str) -> bool {
    let mut parts = raw.split('-');
    let language = parts.next().unwrap_or_default();
    let subtags: Vec<&str> = parts.collect();
    raw.len() <= 35
        && (2..=3).contains(&language.len())
        && language.bytes().all(|b| b.is_ascii_alphabetic())
        && subtags.len() <= 3
        && subtags.iter().all(|tag| {
            (1..=8).contains(&tag.len()) && tag.bytes().all(|b| b.is_ascii_alphanumeric())
        })
}

/// An app version such as `1.4.0` or `1.4.0+12`: a digit, then up to 31 of `[0-9A-Za-z.+-]`.
pub fn is_app_version(raw: &str) -> bool {
    raw.len() <= 32
        && raw.bytes().next().is_some_and(|b| b.is_ascii_digit())
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'-'))
}

/// One installation's registration (REQ-PSH-001).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub installation: InstallationId,
    pub user_id: String,
    /// The session it was made in; revoking that session removes it (REQ-PSH-003).
    pub session: SessionId,
    pub platform: DevicePlatform,
    pub environment: PushEnvironment,
    pub token: PushToken,
    /// The app's language tag; the payload builder picks the notification text with it.
    pub locale: String,
    pub app_version: String,
    /// The person opted in to marketing messages, separately and off by default (REQ-PSH-006).
    pub marketing: bool,
    /// When it was last created or refreshed, on the injected clock (REQ-PSH-005).
    pub refreshed_at: DateTime<Utc>,
}

/// Where registrations are kept.
///
/// [`crate::device_store::InMemoryDeviceStore`] is the sample's. A fork puts its database behind
/// the same trait and keeps three guarantees:
///
/// - [`register`](Self::register) is one transaction: removing the token's other registrations
///   and writing this one (a unique index on the token enforces REQ-PSH-002).
/// - A registration ends with its session (REQ-PSH-003). [`crate::sessions::Sessions`] calls
///   [`remove_session`](Self::remove_session) right after revoking a session and
///   [`remove_user`](Self::remove_user) after removing a user's sessions; with one database, make
///   each pair one transaction, or reference the session row with `ON DELETE CASCADE` so the
///   database does it.
/// - Nothing here logs a token or an installation id (REQ-PSH-007).
pub trait DeviceStore: Send + Sync {
    /// Creates or replaces `registration.installation`'s registration, first removing every other
    /// registration of the same token, of any installation and any user. Returns how many it
    /// removed.
    fn register(&self, registration: Registration) -> usize;

    /// Removes `installation`'s registration if it belongs to `user_id`; `true` when one was
    /// removed. Another user's registration stays (REQ-PSH-004).
    fn unregister(&self, user_id: &str, installation: &InstallationId) -> bool;

    /// Removes every registration made in `session`; returns how many.
    fn remove_session(&self, session: SessionId) -> usize;

    /// Removes every registration of `user_id`; returns how many.
    fn remove_user(&self, user_id: &str) -> usize;

    /// Removes `installation`'s registration only while it still holds `token`, so a token the
    /// provider reports dead never removes the newer token the device registered since.
    fn remove_if_token(&self, installation: &InstallationId, token: &PushToken) -> bool;

    /// Every registration of `user_id`.
    fn for_user(&self, user_id: &str) -> Vec<Registration>;

    /// Removes every registration last refreshed at or before `cutoff`; returns how many.
    fn prune(&self, cutoff: DateTime<Utc>) -> usize;
}

#[cfg(test)]
mod tests {
    use super::*;

    const IOS_TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    // Verifies: REQ-PSH-001 REQ-PSH-010
    #[test]
    fn an_installation_id_is_a_hyphenated_random_uuid() {
        let lower = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c";
        let upper = lower.to_ascii_uppercase();
        assert_eq!(
            InstallationId::parse(lower),
            InstallationId::parse(&upper),
            "one id, either case"
        );
        assert!(InstallationId::parse(lower).is_some());
        for invalid in [
            "",
            "not-a-uuid",
            "2f1c7a5e8b0d4c3e9f6a1d2e3f4a5b6c",
            "{2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c}",
            "urn:uuid:2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c",
            "2f1c7a5e-8b0d-1c3e-9f6a-1d2e3f4a5b6c",
            "2f1c7a5e-8b0d-4c3e-cf6a-1d2e3f4a5b6c",
            "00000000-0000-0000-0000-000000000000",
            "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c0",
        ] {
            assert!(InstallationId::parse(invalid).is_none(), "{invalid}");
        }
    }

    // Verifies: REQ-PSH-007
    #[test]
    fn ids_and_tokens_print_redacted() {
        let id = InstallationId::parse("2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c").unwrap();
        let token = PushToken::parse(DevicePlatform::Ios, IOS_TOKEN).unwrap();
        let printed = format!("{id:?} {token:?}");
        assert_eq!(printed, "[redacted] PushToken([redacted])");
        assert_eq!(token.expose(), IOS_TOKEN);
    }

    // Verifies: REQ-PSH-001
    #[test]
    fn an_apns_token_is_even_length_hex_held_lowercase() {
        let upper = IOS_TOKEN.to_ascii_uppercase();
        let parsed = PushToken::parse(DevicePlatform::Ios, &upper).unwrap();
        assert_eq!(parsed.expose(), IOS_TOKEN);
        assert!(PushToken::parse(DevicePlatform::Ios, &"a".repeat(200)).is_some());
        for invalid in [
            "a".repeat(63),
            "a".repeat(65),
            "a".repeat(202),
            format!("{}g", &IOS_TOKEN[1..]),
            String::new(),
        ] {
            assert!(
                PushToken::parse(DevicePlatform::Ios, &invalid).is_none(),
                "{invalid}"
            );
        }
    }

    // Verifies: REQ-PSH-001
    #[test]
    fn an_fcm_token_is_bounded_url_safe_text_kept_as_given() {
        let token = format!("dGVzdA:APA91b{}", "Xy_-9".repeat(30));
        assert_eq!(
            PushToken::parse(DevicePlatform::Android, &token)
                .unwrap()
                .expose(),
            token
        );
        assert!(PushToken::parse(DevicePlatform::Android, &"a".repeat(32)).is_some());
        assert!(PushToken::parse(DevicePlatform::Android, &"a".repeat(1024)).is_some());
        for invalid in [
            "a".repeat(31),
            "a".repeat(1025),
            format!("{} ", "a".repeat(40)),
            format!("{}/", "a".repeat(40)),
            format!("{}é", "a".repeat(40)),
        ] {
            assert!(
                PushToken::parse(DevicePlatform::Android, &invalid).is_none(),
                "{invalid}"
            );
        }
    }

    // Verifies: REQ-PSH-001
    #[test]
    fn locales_are_bounded_language_tags() {
        for valid in ["en", "ne-NP", "zh-Hant-TW", "es-419", "fil", "sr-Latn-RS-x"] {
            assert!(is_locale_tag(valid), "{valid}");
        }
        for invalid in [
            "",
            "e",
            "engl",
            "en_US",
            "en-",
            "en-123456789",
            "en-a-b-c-d",
            "1n",
            "en US",
            &format!("en-{}", "abcdefgh-".repeat(4)),
        ] {
            assert!(!is_locale_tag(invalid), "{invalid}");
        }
    }

    // Verifies: REQ-PSH-001
    #[test]
    fn app_versions_are_bounded_and_start_with_a_digit() {
        for valid in ["1", "1.4.0", "1.4.0+12", "2.0.0-beta.1", &"1".repeat(32)] {
            assert!(is_app_version(valid), "{valid}");
        }
        for invalid in ["", "v1.0", "1.0 ", "1.0/2", &"1".repeat(33)] {
            assert!(!is_app_version(invalid), "{invalid}");
        }
    }

    #[test]
    fn closed_sets_have_wire_names() {
        assert_eq!(DevicePlatform::Ios.as_str(), "ios");
        assert_eq!(DevicePlatform::Android.as_str(), "android");
        assert_eq!(PushEnvironment::Sandbox.as_str(), "sandbox");
        assert_eq!(PushEnvironment::Production.as_str(), "production");
    }
}
