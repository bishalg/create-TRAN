//! API versioning and client compatibility (spec 028, ADR-0047).
//!
//! One place for what every client and the API must agree on: the versioned base path, the header
//! a client names itself with ([`parse_client`], [`format_client`]), how two versions compare
//! ([`compare_versions`]), where a client stands against the configured minimum and recommended
//! versions ([`client_standing`]), whether the dismissible update prompt shows ([`update_prompt`])
//! and the fallback each wire enum decodes an unknown value to ([`WIRE_ENUMS`]). The constants
//! reach TypeScript, Swift and Kotlin through `pnpm tokens:sync`; the functions reach native code
//! through UniFFI and are mirrored in `@tran/core`. `fixtures/compat.json` pins every copy.
//!
//! Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-005 REQ-VER-008 REQ-VER-010

use std::cmp::Ordering;

/// Every product route lives under this path (REQ-VER-001). It changes only for a breaking change.
pub const API_BASE_PATH: &str = "/api/v1";

/// The health routes stay unversioned: infrastructure calls them, not an app release.
pub const HEALTH_PATH: &str = "/api/health";

/// `X-Tran-Client: <platform>/<version>`, sent with every request (REQ-VER-004).
pub const CLIENT_HEADER: &str = "X-Tran-Client";

/// Answered with [`UPDATE_RECOMMENDED`] to a client below its recommended version (REQ-VER-006).
pub const UPDATE_HEADER: &str = "X-Tran-Update";

/// The value of [`UPDATE_HEADER`].
pub const UPDATE_RECOMMENDED: &str = "recommended";

/// Sent beside [`UPDATE_HEADER`]: the recommended version itself, so an app can remember a
/// dismissed prompt per recommended version (REQ-VER-010).
pub const RECOMMENDED_VERSION_HEADER: &str = "X-Tran-Recommended-Version";

/// The longest version string anyone accepts; it is logged, so it must be bounded.
pub const VERSION_MAX_LEN: usize = 32;

/// At most this many numeric parts (`1.4.0.2`).
const VERSION_MAX_PARTS: usize = 4;

/// At most this many digits in one part, so every part fits a `u64`.
const VERSION_MAX_DIGITS: usize = 9;

/// Who sent a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientPlatform {
    Ios,
    Android,
    Web,
    /// No header, or one that does not parse: served like any other client, never an error.
    Unknown,
}

impl ClientPlatform {
    /// Every platform, in fixture order.
    pub const ALL: [Self; 4] = [Self::Ios, Self::Android, Self::Web, Self::Unknown];

    /// The header's spelling (`ios`), also the log's.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ios => "ios",
            Self::Android => "android",
            Self::Web => "web",
            Self::Unknown => "unknown",
        }
    }

    /// The platform a header names; only the three app platforms, spelled exactly.
    fn from_header(name: &str) -> Option<Self> {
        [Self::Ios, Self::Android, Self::Web]
            .into_iter()
            .find(|platform| platform.as_str() == name)
    }
}

/// A parsed `X-Tran-Client` header: a known platform always has a valid version, an unknown one
/// never has one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Client {
    pub platform: ClientPlatform,
    pub version: Option<String>,
}

impl Client {
    /// The client that sent no usable header.
    pub fn unknown() -> Self {
        Self {
            platform: ClientPlatform::Unknown,
            version: None,
        }
    }
}

/// Whether `value` is a version this API accepts: 1 to 4 numeric parts of at most 9 digits, an
/// optional `-pre-release` or `+build` suffix of `[0-9A-Za-z.-]`, at most [`VERSION_MAX_LEN`]
/// characters in all (`1.4.0`, `2.0`, `1.4.0-beta.1`).
pub fn is_version(value: &str) -> bool {
    if value.is_empty() || value.len() > VERSION_MAX_LEN {
        return false;
    }
    let (core, suffix) = split_suffix(value);
    let suffix_ok = suffix.is_none_or(|rest| {
        !rest.is_empty()
            && rest
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
    });
    let parts: Vec<&str> = core.split('.').collect();
    suffix_ok
        && parts.len() <= VERSION_MAX_PARTS
        && parts.iter().all(|part| {
            (1..=VERSION_MAX_DIGITS).contains(&part.len())
                && part.bytes().all(|b| b.is_ascii_digit())
        })
}

/// `1.4.0-beta+7` → (`1.4.0`, `Some("beta+7")`).
fn split_suffix(value: &str) -> (&str, Option<&str>) {
    match value.find(['-', '+']) {
        Some(at) => (&value[..at], Some(&value[at + 1..])),
        None => (value, None),
    }
}

/// Reads `X-Tran-Client` (REQ-VER-004). `None`, a malformed value, an unknown platform or an
/// invalid version is [`ClientPlatform::Unknown`]: a parse never fails a request.
pub fn parse_client(header: Option<&str>) -> Client {
    header
        .map(str::trim)
        .and_then(|value| value.split_once('/'))
        .and_then(|(platform, version)| {
            let platform = ClientPlatform::from_header(platform)?;
            is_version(version).then(|| Client {
                platform,
                version: Some(version.to_string()),
            })
        })
        .unwrap_or_else(Client::unknown)
}

/// The header value a client sends: `ios/1.4.0`.
pub fn format_client(platform: ClientPlatform, version: &str) -> String {
    format!("{}/{version}", platform.as_str())
}

/// Numeric parts of a version's core, for comparison; a part that does not parse counts as `0`.
fn numeric_parts(version: &str) -> Vec<u64> {
    split_suffix(version.trim())
        .0
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

/// Compares two versions numerically by part (`1.10` is above `1.9`); missing parts are zero
/// (`1.4` equals `1.4.0`) and a pre-release or build suffix is ignored (REQ-VER-005).
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let (a, b) = (numeric_parts(a), numeric_parts(b));
    let len = a.len().max(b.len());
    (0..len)
        .map(|i| {
            let x = a.get(i).copied().unwrap_or(0);
            let y = b.get(i).copied().unwrap_or(0);
            x.cmp(&y)
        })
        .find(|order| order.is_ne())
        .unwrap_or(Ordering::Equal)
}

/// Where a client stands against its platform's thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientStanding {
    /// Served as usual.
    Supported,
    /// Served, with [`UPDATE_HEADER`]: the app offers a dismissible prompt (REQ-VER-006).
    UpdateRecommended,
    /// Answered `426 client.upgrade_required`: the app shows a blocking screen (REQ-VER-005).
    UpgradeRequired,
}

impl ClientStanding {
    pub const ALL: [Self; 3] = [
        Self::Supported,
        Self::UpdateRecommended,
        Self::UpgradeRequired,
    ];

    /// Stable snake_case name, matching `fixtures/compat.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Supported => "supported",
            Self::UpdateRecommended => "update_recommended",
            Self::UpgradeRequired => "upgrade_required",
        }
    }
}

/// The decision of REQ-VER-005 and REQ-VER-006. `minimum` and `recommended` are the client's own
/// platform's (`None`: no threshold). A client without a version is served.
pub fn client_standing(
    client: &Client,
    minimum: Option<&str>,
    recommended: Option<&str>,
) -> ClientStanding {
    let Some(version) = client.version.as_deref() else {
        return ClientStanding::Supported;
    };
    let below = |threshold: Option<&str>| {
        threshold.is_some_and(|t| compare_versions(version, t) == Ordering::Less)
    };
    if below(minimum) {
        ClientStanding::UpgradeRequired
    } else if below(recommended) {
        ClientStanding::UpdateRecommended
    } else {
        ClientStanding::Supported
    }
}

/// What the app knows when an answer arrives, for [`update_prompt`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdatePromptState<'a> {
    /// The standing the last answer implied (`X-Tran-Update: recommended` is
    /// [`ClientStanding::UpdateRecommended`]).
    pub standing: ClientStanding,
    /// `X-Tran-Recommended-Version`, when the answer carried it.
    pub recommended_version: Option<&'a str>,
    /// The recommended version the person last dismissed the prompt for, if any.
    pub dismissed_version: Option<&'a str>,
}

/// Whether to show the dismissible update prompt (REQ-VER-010): only for an update the server
/// recommends, and not again once it was dismissed for this recommended version. A dismissal is
/// never carried to a newer recommended version; with no version on the answer, any dismissal
/// counts.
pub fn update_prompt(state: UpdatePromptState<'_>) -> bool {
    let dismissed = match (state.dismissed_version, state.recommended_version) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(dismissed), Some(recommended)) => {
            compare_versions(dismissed, recommended) == Ordering::Equal
        }
    };
    state.standing == ClientStanding::UpdateRecommended && !dismissed
}

/// An enum a client decodes from a response, and the value it reads an unknown one as (REQ-VER-008).
/// A newer server may add a value; an older app must then fall back instead of failing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WireEnum {
    /// Stable snake_case name, matching `fixtures/compat.json` and the generated tables.
    pub name: &'static str,
    /// The response field that carries it.
    pub field: &'static str,
    /// Every value this build knows, in catalogue order.
    pub values: &'static [&'static str],
    /// What an unknown value decodes to: always one of [`WireEnum::values`].
    pub fallback: &'static str,
}

impl WireEnum {
    /// `raw` when this build knows it, else [`WireEnum::fallback`].
    pub fn decode(&self, raw: &str) -> &'static str {
        self.values
            .iter()
            .copied()
            .find(|value| *value == raw)
            .unwrap_or(self.fallback)
    }
}

/// `user.role` of every session answer. An unknown role is read as the voter, the role with the
/// least access, so a newer server can never widen an old app's menu.
pub const USER_ROLE: WireEnum = WireEnum {
    name: "user_role",
    field: "role",
    values: &["citizen_voter", "election_auditor"],
    fallback: "citizen_voter",
};

/// `country_source` of an eligibility answer: how the server chose the country. An unknown source
/// is read as `default`, the claim that says least.
pub const COUNTRY_SOURCE: WireEnum = WireEnum {
    name: "country_source",
    field: "country_source",
    values: &[
        "x-debug-country",
        "loopback-default",
        "private-range-stub",
        "default",
    ],
    fallback: "default",
};

/// Every wire enum a client decodes, in catalogue order. An error `code` is not here: an unknown
/// code is classified by its HTTP status (REQ-ERR-004, `feedback::code_for_http_status`).
pub const WIRE_ENUMS: [WireEnum; 2] = [USER_ROLE, COUNTRY_SOURCE];

/// The wire enum named `name`, if any.
pub fn wire_enum(name: &str) -> Option<WireEnum> {
    WIRE_ENUMS
        .into_iter()
        .find(|candidate| candidate.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::UserRole;

    #[test]
    fn the_base_path_is_versioned_and_health_is_not() {
        assert_eq!(API_BASE_PATH, "/api/v1");
        assert!(!HEALTH_PATH.starts_with(API_BASE_PATH));
    }

    #[test]
    fn every_platform_has_a_name_and_only_apps_parse() {
        let names: Vec<&str> = ClientPlatform::ALL.iter().map(|p| p.as_str()).collect();
        assert_eq!(names, ["ios", "android", "web", "unknown"]);
        assert_eq!(ClientPlatform::from_header("unknown"), None);
        assert_eq!(parse_client(Some("unknown/1.0.0")), Client::unknown());
    }

    #[test]
    fn versions_are_bounded() {
        assert!(is_version("1"));
        assert!(is_version("1.4.0.2"));
        assert!(!is_version("1.4.0.2.1"));
        assert!(!is_version("1234567890"));
        assert!(!is_version(&format!(
            "1.0.0-{}",
            "a".repeat(VERSION_MAX_LEN)
        )));
        assert!(!is_version("1.0.0-"));
        assert!(!is_version("1.0.0-beta!"));
        assert!(!is_version("1..0"));
    }

    #[test]
    fn standings_have_snake_case_names() {
        let names: Vec<&str> = ClientStanding::ALL.iter().map(|s| s.as_str()).collect();
        assert_eq!(
            names,
            ["supported", "update_recommended", "upgrade_required"]
        );
    }

    // Verifies: REQ-VER-008
    #[test]
    fn every_fallback_is_a_known_value_and_roles_match_the_catalogue() {
        for wire in WIRE_ENUMS {
            assert!(wire.values.contains(&wire.fallback), "{}", wire.name);
            assert_eq!(wire_enum(wire.name), Some(wire));
        }
        assert_eq!(wire_enum("verdict_source"), None);
        let roles: Vec<&str> = [UserRole::CitizenVoter, UserRole::ElectionAuditor]
            .iter()
            .map(UserRole::as_str)
            .collect();
        assert_eq!(USER_ROLE.values, roles.as_slice());
    }
}
