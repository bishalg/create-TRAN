//! What a notification says, for APNs and FCM v1 (REQ-PSH-006, ADR-0044): pure builders, pinned
//! by the `payloads` section of `fixtures/push.json`.
//!
//! A notification is a doorbell. Its payload carries a type, an opaque id and a fixed title and
//! body, never a name, an email, a verdict or a token; the app fetches what changed with its own
//! session. The text is chosen here, from the dictionaries in `locales/`, by the registration's
//! locale. Not `loc-key` on the device: APNs resolves a `loc-key` only in the app's
//! `Localizable` table, which the iOS app deliberately does not have (one String Catalog per
//! module, `native-strings.test.ts`), and the registration already carries the locale. The text
//! the provider sees is the same fixed sentence for everyone, so it holds nothing about the
//! person. The provider address (the APNs device path, FCM's `message.token`) is the sender's to
//! add; it is never part of a body built here.

use std::sync::OnceLock;

use serde_json::{json, Value};

/// One kind of notification the API may send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Notification {
    /// Stable dotted name, sent as `type` so the app knows what to fetch.
    pub kind: &'static str,
    /// Locale key of the title.
    pub title_key: &'static str,
    /// Locale key of the body.
    pub body_key: &'static str,
    /// Repeats with this key replace each other on the device and at the provider.
    pub collapse_key: &'static str,
    /// A marketing message: sent only to registrations that opted in (REQ-PSH-006).
    pub marketing: bool,
}

/// "You can vote now": the sample's one notification, sent when a person who asked to be told
/// becomes old enough to vote.
pub const ELIGIBILITY_REACHED: Notification = Notification {
    kind: "eligibility.reached",
    title_key: "eligibility.notification.reached.title",
    body_key: "eligibility.notification.reached.body",
    collapse_key: "eligibility.reached",
    marketing: false,
};

/// Every notification the API may send.
pub const NOTIFICATIONS: [Notification; 1] = [ELIGIBILITY_REACHED];

impl Notification {
    /// Whether a registration with this marketing choice may receive it (REQ-PSH-006).
    pub fn may_reach(&self, registration_marketing: bool) -> bool {
        !self.marketing || registration_marketing
    }
}

/// What the app fetches when the doorbell rings: 1–64 of `[A-Za-z0-9_-]`, so nothing readable
/// about the person fits in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpaqueId(String);

impl OpaqueId {
    pub fn parse(raw: &str) -> Option<Self> {
        let valid = (1..=64).contains(&raw.len())
            && raw
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'));
        valid.then(|| Self(raw.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The locale the dictionaries fall back to.
pub const BASE_LOCALE: &str = "en";

/// The module the notification copy lives in, embedded for every locale. A test fails when
/// `locales/` gains a locale this list lacks.
const MODULE: &str = "eligibility";
const DICTIONARIES: [(&str, &str); 3] = [
    (
        "en",
        include_str!("../../../../locales/en/eligibility.json"),
    ),
    (
        "hi",
        include_str!("../../../../locales/hi/eligibility.json"),
    ),
    (
        "ne",
        include_str!("../../../../locales/ne/eligibility.json"),
    ),
];

fn dictionaries() -> &'static [(&'static str, Value)] {
    static PARSED: OnceLock<Vec<(&'static str, Value)>> = OnceLock::new();
    PARSED.get_or_init(|| {
        DICTIONARIES
            .iter()
            .map(|(locale, text)| (*locale, serde_json::from_str(text).unwrap_or(Value::Null)))
            .collect()
    })
}

/// The dictionary for a language tag: the tag itself, then its language, then English.
pub fn resolve_locale(tag: &str) -> &'static str {
    let language = tag.split('-').next().unwrap_or_default();
    let find = |wanted: &str| {
        DICTIONARIES
            .iter()
            .map(|(locale, _)| *locale)
            .find(|locale| locale.eq_ignore_ascii_case(wanted))
    };
    find(tag).or_else(|| find(language)).unwrap_or(BASE_LOCALE)
}

/// The text of `key` in `tag`'s dictionary, else English, else the key itself (a test keeps every
/// catalogue key in every dictionary).
pub fn localized<'a>(tag: &str, key: &'a str) -> &'a str {
    let pointer = key
        .strip_prefix(MODULE)
        .and_then(|rest| rest.strip_prefix('.'))
        .map(|rest| format!("/{}", rest.replace('.', "/")));
    let find = |locale: &str| {
        let pointer = pointer.as_deref()?;
        dictionaries()
            .iter()
            .filter(|(name, _)| *name == locale)
            .find_map(|(_, dictionary)| dictionary.pointer(pointer)?.as_str())
    };
    find(resolve_locale(tag))
        .or_else(|| find(BASE_LOCALE))
        .unwrap_or(key)
}

/// The `type` and `id` every payload carries for the app.
fn doorbell(notification: &Notification, id: &OpaqueId) -> Value {
    json!({ "type": notification.kind, "id": id.as_str() })
}

/// An APNs request: the headers that matter and the JSON body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApnsRequest {
    /// `apns-push-type`: `alert`, because it shows text.
    pub push_type: &'static str,
    /// `apns-collapse-id`.
    pub collapse_id: &'static str,
    /// `apns-topic`: the app's bundle id.
    pub topic: String,
    pub body: Value,
}

impl ApnsRequest {
    /// The headers as `(name, value)` pairs, as the sender sets them.
    pub fn headers(&self) -> [(&'static str, &str); 3] {
        [
            ("apns-push-type", self.push_type),
            ("apns-collapse-id", self.collapse_id),
            ("apns-topic", &self.topic),
        ]
    }
}

/// The APNs request for `notification` about `id`, in `locale`, for the app `topic`.
pub fn apns_request(
    notification: &Notification,
    id: &OpaqueId,
    locale: &str,
    topic: &str,
) -> ApnsRequest {
    let mut body = doorbell(notification, id);
    body["aps"] = json!({
        "alert": {
            "title": localized(locale, notification.title_key),
            "body": localized(locale, notification.body_key),
        },
        "sound": "default",
    });
    ApnsRequest {
        push_type: "alert",
        collapse_id: notification.collapse_key,
        topic: topic.to_string(),
        body,
    }
}

/// The FCM v1 `messages:send` body for `notification` about `id`, in `locale`, without
/// `message.token`. `android.notification.tag` replaces an earlier one on the device;
/// `android.collapse_key` replaces one still waiting at FCM.
pub fn fcm_message(notification: &Notification, id: &OpaqueId, locale: &str) -> Value {
    json!({
        "message": {
            "notification": {
                "title": localized(locale, notification.title_key),
                "body": localized(locale, notification.body_key),
            },
            "android": {
                "collapse_key": notification.collapse_key,
                "notification": { "tag": notification.collapse_key },
            },
            "data": doorbell(notification, id),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::path::Path;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixtures {
        payloads: Vec<PayloadCase>,
        marketing: Vec<MarketingCase>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PayloadCase {
        name: String,
        #[serde(rename = "type")]
        kind: String,
        id: String,
        locale: String,
        topic: String,
        apns: ApnsCase,
        fcm: Value,
    }

    #[derive(serde::Deserialize)]
    struct ApnsCase {
        headers: std::collections::BTreeMap<String, String>,
        body: Value,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MarketingCase {
        notification_marketing: bool,
        registration_marketing: bool,
        sent: bool,
    }

    fn fixtures() -> Fixtures {
        serde_json::from_str(include_str!("../../../../fixtures/push.json")).unwrap()
    }

    fn notification(kind: &str) -> Notification {
        NOTIFICATIONS.into_iter().find(|n| n.kind == kind).unwrap()
    }

    // Verifies: REQ-PSH-006
    #[test]
    fn every_pinned_payload_is_built_exactly() {
        let cases = fixtures().payloads;
        assert!(cases.len() >= 5);
        for case in cases {
            let notification = notification(&case.kind);
            let id = OpaqueId::parse(&case.id).unwrap();
            let apns = apns_request(&notification, &id, &case.locale, &case.topic);
            let headers: std::collections::BTreeMap<String, String> = apns
                .headers()
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect();
            assert_eq!(headers, case.apns.headers, "{}", case.name);
            assert_eq!(apns.body, case.apns.body, "{}", case.name);
            assert_eq!(
                fcm_message(&notification, &id, &case.locale),
                case.fcm,
                "{}",
                case.name
            );
        }
    }

    // Verifies: REQ-PSH-006
    #[test]
    fn a_marketing_notification_reaches_only_those_who_opted_in() {
        let cases = fixtures().marketing;
        assert_eq!(cases.len(), 4);
        for case in cases {
            let notification = Notification {
                marketing: case.notification_marketing,
                ..ELIGIBILITY_REACHED
            };
            assert_eq!(
                notification.may_reach(case.registration_marketing),
                case.sent
            );
        }
        assert!(NOTIFICATIONS.iter().all(|n| !n.marketing));
    }

    // Verifies: REQ-PSH-006
    #[test]
    fn every_notification_has_fixed_text_in_every_locale() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../locales");
        let folders: BTreeSet<String> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.is_dir())
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        let embedded: BTreeSet<String> = DICTIONARIES.iter().map(|(l, _)| l.to_string()).collect();
        assert_eq!(embedded, folders, "embed every locale's {MODULE}.json");
        let mut keys = BTreeSet::new();
        for notification in NOTIFICATIONS {
            for key in [notification.title_key, notification.body_key] {
                assert!(keys.insert(key), "{key} twice");
                for (locale, _) in DICTIONARIES {
                    let text = localized(locale, key);
                    assert!(!text.is_empty() && text != key, "{locale}: {key}");
                    assert!(!text.contains('{'), "{key} must take no placeholder");
                }
            }
            assert!(
                notification.collapse_key.len() <= 64,
                "APNs caps the collapse id"
            );
        }
    }

    // Verifies: REQ-PSH-006
    #[test]
    fn locales_fall_back_to_the_language_then_english() {
        assert_eq!(resolve_locale("ne"), "ne");
        assert_eq!(resolve_locale("NE-np"), "ne");
        assert_eq!(resolve_locale("hi-IN"), "hi");
        assert_eq!(resolve_locale("fr-FR"), "en");
        assert_eq!(resolve_locale(""), "en");
        // A key no dictionary has reads as itself.
        let missing = "eligibility.notification.nope";
        assert_eq!(localized("ne", missing), missing);
        assert_eq!(localized("ne", "auth.title"), "auth.title");
        assert_eq!(
            localized("ne-NP", ELIGIBILITY_REACHED.title_key),
            localized("ne", ELIGIBILITY_REACHED.title_key)
        );
    }

    // Verifies: REQ-PSH-006
    #[test]
    fn an_opaque_id_has_room_for_nothing_personal() {
        for valid in ["a", "evt_01HZX-9", &"x".repeat(64)] {
            assert_eq!(OpaqueId::parse(valid).unwrap().as_str(), valid);
        }
        for invalid in ["", "voter@example.com", "Asha Rai", "a/b", &"x".repeat(65)] {
            assert!(OpaqueId::parse(invalid).is_none(), "{invalid}");
        }
    }
}
