//! Feature flags and remote configuration evaluation (spec 029, ADR-0048).
//!
//! Flags are declared once in Rust with their ID, type, safe default, whether they are live,
//! owner, purpose and expiry date (REQ-CFG-001).
//! Evaluation is a pure function matching rules against client platform, version, and bucket (REQ-CFG-003).
//! The bucket is derived on the device from the installation ID (REQ-CFG-006).
//!
//! Verifies: REQ-CFG-001 REQ-CFG-003 REQ-CFG-006 REQ-CFG-007 REQ-CFG-010

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::compat::{compare_versions, ClientPlatform};

/// The HTTP header carrying the caller's derived bucket (0 to 99).
pub const BUCKET_HEADER: &str = "X-Tran-Bucket";

/// Maximum length of a valid flag ID.
pub const FLAG_ID_MAX_LEN: usize = 64;

/// Remote configuration policy (spec 029, REQ-CFG-004).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigPolicy {
    /// Maximum cache age / polling window in seconds (300 = 5 minutes).
    pub max_age_seconds: u64,
}

pub const CONFIG_POLICY: ConfigPolicy = ConfigPolicy {
    max_age_seconds: 300,
};

/// Supported types of feature flag values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FlagType {
    /// Boolean toggle (e.g. feature enabled or disabled).
    Boolean,
    /// Integer numeric value (e.g. limit or count).
    Integer,
    /// Closed set or descriptive string value.
    String,
}

/// A strongly typed flag value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FlagValue {
    /// Boolean variant.
    Boolean(bool),
    /// Integer variant.
    Integer(i64),
    /// String variant.
    String(String),
}

impl FlagValue {
    /// Returns the corresponding [`FlagType`] of this value.
    pub fn flag_type(&self) -> FlagType {
        match self {
            Self::Boolean(_) => FlagType::Boolean,
            Self::Integer(_) => FlagType::Integer,
            Self::String(_) => FlagType::String,
        }
    }

    /// Returns the boolean value if this is a [`FlagValue::Boolean`].
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Boolean(b) => Some(*b),
            _ => None,
        }
    }

    /// Returns the integer value if this is a [`FlagValue::Integer`].
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Integer(i) => Some(*i),
            _ => None,
        }
    }

    /// Returns the string slice if this is a [`FlagValue::String`].
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s.as_str()),
            _ => None,
        }
    }
}

/// A declared feature flag definition in the catalogue (REQ-CFG-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlagDefinition {
    /// Unique identifier for the flag.
    pub id: &'static str,
    /// Type of the flag.
    pub flag_type: FlagType,
    /// Default value if no rules match or server is unreachable.
    pub default_value: FlagValue,
    /// Whether this flag updates live while running or only on launch.
    pub live: bool,
    /// Team or individual owner of the flag.
    pub owner: &'static str,
    /// Purpose description of the flag.
    pub purpose: &'static str,
    /// ISO 8601 expiry date string (YYYY-MM-DD).
    pub expiry: &'static str,
}

/// The "Notify me" reminder flag (spec 027, REQ-CFG-007).
pub const FLAG_NOTIFY_ME: &str = "notify_me";

/// The catalogue of all declared feature flags (REQ-CFG-001).
pub const ALL_FLAGS: &[FlagDefinition] = &[FlagDefinition {
    id: FLAG_NOTIFY_ME,
    flag_type: FlagType::Boolean,
    default_value: FlagValue::Boolean(false),
    live: true,
    owner: "growth",
    purpose: "Remind voter when registration opens",
    expiry: "2027-01-01",
}];

/// Finds a declared flag definition by its ID.
pub fn find_flag(id: &str) -> Option<&'static FlagDefinition> {
    ALL_FLAGS.iter().find(|f| f.id == id)
}

/// Derives a stable rollout bucket from 0 to 99 from an installation ID (REQ-CFG-006).
///
/// Trims whitespace and folds ASCII casing before computing SHA-256.
/// Takes the first 4 bytes as a big-endian `u32` modulo 100.
pub fn derive_bucket(installation_id: &str) -> u8 {
    let trimmed = installation_id.trim();
    let mut hasher = Sha256::new();
    for byte in trimmed.bytes() {
        hasher.update([byte.to_ascii_lowercase()]);
    }
    let hash = hasher.finalize();
    let num = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
    (num % 100) as u8
}

/// A single targeting rule within a flag's configuration (REQ-CFG-003).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rule {
    /// Target platform (e.g. "ios", "android", "web"). `None` matches any platform.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// Minimum client version required. `None` matches any version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
    /// Rollout percentage from 0 to 100.
    #[serde(default = "default_rollout")]
    pub rollout: u8,
    /// Value to provide when this rule matches.
    pub value: FlagValue,
}

const fn default_rollout() -> u8 {
    100
}

/// The context of the client making a remote config request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientEvaluationContext<'a> {
    /// Platform of the calling client.
    pub platform: ClientPlatform,
    /// Client version, if known.
    pub version: Option<&'a str>,
    /// Calling client's derived bucket (0 to 99).
    pub bucket: u8,
}

/// Evaluates a feature flag against a set of rules and client context (REQ-CFG-003).
///
/// Rules are evaluated in order. The first rule whose platform, minimum version,
/// and rollout bucket all match returns its value, provided the value matches
/// the flag's declared type. If no rule matches, or if a rule's value type is invalid,
/// the flag's safe default value is returned.
pub fn evaluate(
    flag: &FlagDefinition,
    rules: &[Rule],
    client: &ClientEvaluationContext<'_>,
) -> FlagValue {
    for rule in rules {
        if let Some(p) = &rule.platform {
            if !p.eq_ignore_ascii_case(client.platform.as_str()) {
                continue;
            }
        }

        if let Some(min_ver) = &rule.min_version {
            match client.version {
                Some(ver) if compare_versions(ver, min_ver) != Ordering::Less => {}
                _ => continue,
            }
        }

        if client.bucket >= rule.rollout {
            continue;
        }

        if rule.value.flag_type() != flag.flag_type {
            return flag.default_value.clone();
        }

        return rule.value.clone();
    }

    flag.default_value.clone()
}

/// Validates that a flag ID does not contain secret-like tokens (REQ-CFG-010, REQ-SEC-003).
pub fn is_safe_flag_id(id: &str) -> bool {
    if id.is_empty() || id.len() > FLAG_ID_MAX_LEN {
        return false;
    }
    let lower = id.to_ascii_lowercase();
    let secret_words = [
        "secret",
        "token",
        "password",
        "key",
        "credential",
        "private",
        "api_key",
        "apikey",
    ];
    !secret_words.iter().any(|word| lower.contains(word))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_catalogue_contains_notify_me_with_safe_defaults() {
        // Verifies: REQ-CFG-001 REQ-CFG-004 REQ-CFG-007
        assert_eq!(CONFIG_POLICY.max_age_seconds, 300);
        let flag = find_flag(FLAG_NOTIFY_ME).expect("notify_me flag must be declared");
        assert_eq!(flag.id, "notify_me");
        assert_eq!(flag.flag_type, FlagType::Boolean);
        assert_eq!(flag.default_value, FlagValue::Boolean(false));
        assert!(flag.live);
        assert_eq!(flag.owner, "growth");
        assert!(!flag.purpose.is_empty());
        assert!(chrono::NaiveDate::parse_from_str(flag.expiry, "%Y-%m-%d").is_ok());
    }

    #[test]
    fn flag_values_accessors_and_types() {
        // Verifies: REQ-CFG-001
        let b = FlagValue::Boolean(true);
        assert_eq!(b.flag_type(), FlagType::Boolean);
        assert_eq!(b.as_bool(), Some(true));
        assert_eq!(b.as_i64(), None);
        assert_eq!(b.as_str(), None);

        let i = FlagValue::Integer(42);
        assert_eq!(i.flag_type(), FlagType::Integer);
        assert_eq!(i.as_bool(), None);
        assert_eq!(i.as_i64(), Some(42));
        assert_eq!(i.as_str(), None);

        let s = FlagValue::String("hello".to_string());
        assert_eq!(s.flag_type(), FlagType::String);
        assert_eq!(s.as_bool(), None);
        assert_eq!(s.as_i64(), None);
        assert_eq!(s.as_str(), Some("hello"));
    }

    #[test]
    fn derive_bucket_is_stable_bounded_and_case_insensitive() {
        // Verifies: REQ-CFG-006
        let b1 = derive_bucket("2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c");
        let b2 = derive_bucket("2F1C7A5E-8B0D-4C3E-9F6A-1D2E3F4A5B6C");
        let b3 = derive_bucket("  2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c  ");
        assert_eq!(b1, 83);
        assert_eq!(b2, 83);
        assert_eq!(b3, 83);
        assert!(b1 < 100);
    }

    #[test]
    fn find_flag_unknown_returns_none() {
        // Verifies: REQ-CFG-001
        assert_eq!(find_flag("non_existent_flag"), None);
    }

    #[test]
    fn safe_flag_id_rejects_empty_long_or_secret_names() {
        // Verifies: REQ-CFG-010
        assert!(is_safe_flag_id("notify_me"));
        assert!(is_safe_flag_id("dark_mode"));
        assert!(!is_safe_flag_id(""));
        assert!(!is_safe_flag_id(&"a".repeat(65)));
        assert!(!is_safe_flag_id("auth_token"));
        assert!(!is_safe_flag_id("api_key"));
        assert!(!is_safe_flag_id("my_apikey"));
        assert!(!is_safe_flag_id("secret_feature"));
        assert!(!is_safe_flag_id("private_key"));
        assert!(!is_safe_flag_id("user_password"));
        assert!(!is_safe_flag_id("app_credential"));
    }

    #[test]
    fn rule_deserialization_uses_default_rollout() {
        // Verifies: REQ-CFG-003
        let r: Rule = serde_json::from_str(r#"{"value": true}"#).unwrap();
        assert_eq!(r.rollout, 100);
        assert_eq!(r.value, FlagValue::Boolean(true));
        assert!(r.platform.is_none());
        assert!(r.min_version.is_none());
    }

    #[test]
    fn evaluate_matches_rules_correctly() {
        // Verifies: REQ-CFG-003
        let flag = find_flag(FLAG_NOTIFY_ME).unwrap();
        let ctx = ClientEvaluationContext {
            platform: ClientPlatform::Ios,
            version: Some("1.4.0"),
            bucket: 10,
        };

        // Platform mismatch
        let rules = [Rule {
            platform: Some("android".to_string()),
            min_version: None,
            rollout: 100,
            value: FlagValue::Boolean(true),
        }];
        assert_eq!(evaluate(flag, &rules, &ctx), FlagValue::Boolean(false));

        // Matching platform
        let rules = [Rule {
            platform: Some("ios".to_string()),
            min_version: Some("1.2.0".to_string()),
            rollout: 50,
            value: FlagValue::Boolean(true),
        }];
        assert_eq!(evaluate(flag, &rules, &ctx), FlagValue::Boolean(true));

        // Version lower than min_version
        let ctx_old = ClientEvaluationContext {
            platform: ClientPlatform::Ios,
            version: Some("1.1.0"),
            bucket: 10,
        };
        assert_eq!(evaluate(flag, &rules, &ctx_old), FlagValue::Boolean(false));

        // Missing client version when min_version is specified
        let ctx_no_ver = ClientEvaluationContext {
            platform: ClientPlatform::Ios,
            version: None,
            bucket: 10,
        };
        assert_eq!(
            evaluate(flag, &rules, &ctx_no_ver),
            FlagValue::Boolean(false)
        );

        // Bucket outside rollout
        let ctx_high_bucket = ClientEvaluationContext {
            platform: ClientPlatform::Ios,
            version: Some("1.4.0"),
            bucket: 70,
        };
        assert_eq!(
            evaluate(flag, &rules, &ctx_high_bucket),
            FlagValue::Boolean(false)
        );

        // Value type mismatch returns default
        let rules_bad_type = [Rule {
            platform: Some("ios".to_string()),
            min_version: None,
            rollout: 100,
            value: FlagValue::Integer(100),
        }];
        assert_eq!(
            evaluate(flag, &rules_bad_type, &ctx),
            FlagValue::Boolean(false)
        );
    }
}
