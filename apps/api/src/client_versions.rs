//! The minimum and recommended app version per platform (REQ-VER-005, REQ-VER-006, ADR-0047).
//!
//! Six optional variables, one pair per platform, because the stores approve on different days.
//! Unset (or blank) means no threshold. A value that is not a version stops start-up with a
//! [`ClientVersionError`] naming the variable. Raising one needs no release, only a restart.

use rust_core::compat::{is_version, ClientPlatform};

/// One platform's thresholds; `None` means none.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VersionThreshold {
    /// Below this, every product route answers `426 client.upgrade_required`.
    pub minimum: Option<String>,
    /// Below this (and at or above the minimum), responses carry `X-Tran-Update: recommended`.
    pub recommended: Option<String>,
}

/// The variables as read from the environment, blank counted as unset.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClientVersionSettings {
    pub ios: VersionThreshold,
    pub android: VersionThreshold,
    pub web: VersionThreshold,
}

/// A threshold that does not parse. The message names the variable; a version is not a secret,
/// but the rule is the same as for every other variable.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0} is not a version (for example 1.4.0)")]
pub struct ClientVersionError(pub &'static str);

/// The validated thresholds the edge enforces.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClientThresholds(ClientVersionSettings);

impl ClientVersionSettings {
    /// Reads the six variables through `lookup`; blank values are unset.
    pub fn from_lookup(lookup: &impl Fn(&str) -> Option<String>) -> Self {
        // Literal names, so the env contract (`pnpm secrets:check`) sees what is read.
        let read = |value: Option<String>| {
            value
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        Self {
            ios: VersionThreshold {
                minimum: read(lookup("CLIENT_MIN_VERSION_IOS")),
                recommended: read(lookup("CLIENT_RECOMMENDED_VERSION_IOS")),
            },
            android: VersionThreshold {
                minimum: read(lookup("CLIENT_MIN_VERSION_ANDROID")),
                recommended: read(lookup("CLIENT_RECOMMENDED_VERSION_ANDROID")),
            },
            web: VersionThreshold {
                minimum: read(lookup("CLIENT_MIN_VERSION_WEB")),
                recommended: read(lookup("CLIENT_RECOMMENDED_VERSION_WEB")),
            },
        }
    }
}

impl ClientThresholds {
    /// Validates every set value, naming the first variable that is not a version.
    pub fn from_settings(settings: &ClientVersionSettings) -> Result<Self, ClientVersionError> {
        let checks = [
            ("CLIENT_MIN_VERSION_IOS", &settings.ios.minimum),
            ("CLIENT_RECOMMENDED_VERSION_IOS", &settings.ios.recommended),
            ("CLIENT_MIN_VERSION_ANDROID", &settings.android.minimum),
            (
                "CLIENT_RECOMMENDED_VERSION_ANDROID",
                &settings.android.recommended,
            ),
            ("CLIENT_MIN_VERSION_WEB", &settings.web.minimum),
            ("CLIENT_RECOMMENDED_VERSION_WEB", &settings.web.recommended),
        ];
        match checks
            .into_iter()
            .find(|(_, value)| value.as_deref().is_some_and(|v| !is_version(v)))
        {
            Some((name, _)) => Err(ClientVersionError(name)),
            None => Ok(Self(settings.clone())),
        }
    }

    /// The thresholds of `platform`; an unknown client has none.
    pub fn for_platform(&self, platform: ClientPlatform) -> Option<&VersionThreshold> {
        match platform {
            ClientPlatform::Ios => Some(&self.0.ios),
            ClientPlatform::Android => Some(&self.0.android),
            ClientPlatform::Web => Some(&self.0.web),
            ClientPlatform::Unknown => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn settings(pairs: &[(&str, &str)]) -> ClientVersionSettings {
        let vars: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        ClientVersionSettings::from_lookup(&|key| vars.get(key).cloned())
    }

    // Verifies: REQ-VER-005
    #[test]
    fn unset_and_blank_mean_no_threshold() {
        let read = settings(&[("CLIENT_MIN_VERSION_IOS", "  ")]);
        assert_eq!(read, ClientVersionSettings::default());
        let thresholds = ClientThresholds::from_settings(&read).unwrap();
        assert_eq!(
            thresholds.for_platform(ClientPlatform::Ios),
            Some(&VersionThreshold::default())
        );
        assert_eq!(thresholds.for_platform(ClientPlatform::Unknown), None);
    }

    // Verifies: REQ-VER-005 REQ-VER-006
    #[test]
    fn each_platform_reads_its_own_pair() {
        let read = settings(&[
            ("CLIENT_MIN_VERSION_IOS", "1.2.0"),
            ("CLIENT_RECOMMENDED_VERSION_IOS", " 1.5.0 "),
            ("CLIENT_MIN_VERSION_ANDROID", "1.1"),
            ("CLIENT_RECOMMENDED_VERSION_ANDROID", "1.6.0"),
            ("CLIENT_MIN_VERSION_WEB", "1.0.0"),
            ("CLIENT_RECOMMENDED_VERSION_WEB", "2.0.0"),
        ]);
        let thresholds = ClientThresholds::from_settings(&read).unwrap();
        let pair = |p| {
            let t = thresholds.for_platform(p).unwrap();
            (t.minimum.clone().unwrap(), t.recommended.clone().unwrap())
        };
        assert_eq!(pair(ClientPlatform::Ios), ("1.2.0".into(), "1.5.0".into()));
        assert_eq!(
            pair(ClientPlatform::Android),
            ("1.1".into(), "1.6.0".into())
        );
        assert_eq!(pair(ClientPlatform::Web), ("1.0.0".into(), "2.0.0".into()));
    }

    // Verifies: REQ-VER-005
    #[test]
    fn a_malformed_value_names_its_variable_and_never_its_value() {
        for name in [
            "CLIENT_MIN_VERSION_IOS",
            "CLIENT_RECOMMENDED_VERSION_IOS",
            "CLIENT_MIN_VERSION_ANDROID",
            "CLIENT_RECOMMENDED_VERSION_ANDROID",
            "CLIENT_MIN_VERSION_WEB",
            "CLIENT_RECOMMENDED_VERSION_WEB",
        ] {
            let err =
                ClientThresholds::from_settings(&settings(&[(name, "latest-secret")])).unwrap_err();
            assert_eq!(err, ClientVersionError(name));
            let message = err.to_string();
            assert!(message.starts_with(name), "{message}");
            assert!(!message.contains("latest-secret"), "{message}");
        }
    }
}
