//! The permission catalogue and the one decision every app makes before asking (spec 026,
//! ADR-0043).
//!
//! [`PERMISSIONS`] lists every system permission the apps may ask for: the feature it serves, the
//! control whose tap is the only thing that may ask, its copy (locale keys), what the feature does
//! without it, and what each platform declares for it. [`permission_step`] maps the platform's
//! status to the next step, so iOS and Android never decide it twice. TypeScript receives the
//! catalogue through `pnpm tokens:sync`, native code through UniFFI; `fixtures/permissions.json`
//! pins both on every platform.
//!
//! Adding a permission (the push phase adds `notifications`): a [`PermissionId`] variant, its
//! entry below, its strings in every locale, its declarations, and its gateway call.
//!
//! Verifies: REQ-PRV-001 REQ-PRV-002

use serde::Serialize;

/// A permission the apps may ask for (REQ-PRV-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionId {
    /// Approximate location while the app is in use, read once (REQ-PRV-006).
    LocationApproximate,
}

impl PermissionId {
    pub const ALL: [Self; 1] = [Self::LocationApproximate];

    /// Stable snake_case name, matching `fixtures/permissions.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocationApproximate => "location_approximate",
        }
    }

    /// The catalogue entry of this permission.
    pub fn entry(self) -> Permission {
        match self {
            Self::LocationApproximate => LOCATION_APPROXIMATE,
        }
    }
}

/// What the platform says about a permission right now, in one vocabulary for both platforms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    /// The system prompt has not been shown.
    NotDetermined,
    /// Granted as asked.
    Granted,
    /// Granted, with reduced accuracy (iOS approximate location, Android coarse location).
    GrantedApproximate,
    /// Refused, but the system can still ask again (Android, before the second refusal).
    Denied,
    /// Refused for good: only the Settings app can change it.
    DeniedPermanently,
    /// The person cannot grant it (parental controls, device management).
    Restricted,
}

impl PermissionStatus {
    pub const ALL: [Self; 6] = [
        Self::NotDetermined,
        Self::Granted,
        Self::GrantedApproximate,
        Self::Denied,
        Self::DeniedPermanently,
        Self::Restricted,
    ];

    /// Stable snake_case name, matching `fixtures/permissions.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotDetermined => "not_determined",
            Self::Granted => "granted",
            Self::GrantedApproximate => "granted_approximate",
            Self::Denied => "denied",
            Self::DeniedPermanently => "denied_permanently",
            Self::Restricted => "restricted",
        }
    }
}

/// What the app does next, after a tap on the control that needs the permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStep {
    /// Show the app's own explanation, with "Continue" and "Not now".
    ShowPriming,
    /// Show the system prompt.
    RequestSystem,
    /// Go on with the feature.
    UseFeature,
    /// Say once, inline, that the setting can be changed in Settings; never ask again.
    OfferSettings,
}

impl PermissionStep {
    pub const ALL: [Self; 4] = [
        Self::ShowPriming,
        Self::RequestSystem,
        Self::UseFeature,
        Self::OfferSettings,
    ];

    /// Stable snake_case name, matching `fixtures/permissions.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ShowPriming => "show_priming",
            Self::RequestSystem => "request_system",
            Self::UseFeature => "use_feature",
            Self::OfferSettings => "offer_settings",
        }
    }
}

/// What the feature does when the permission is refused, restricted or unavailable (REQ-PRV-004).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionFallback {
    /// The person keeps entering the value by hand (the country stays hand-picked); nothing is
    /// presented as an error.
    KeepManualEntry,
}

impl PermissionFallback {
    pub const ALL: [Self; 1] = [Self::KeepManualEntry];

    /// Stable snake_case name, matching `fixtures/permissions.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::KeepManualEntry => "keep_manual_entry",
        }
    }
}

/// One entry of the catalogue (REQ-PRV-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Permission {
    pub id: PermissionId,
    /// Stable snake_case name of the feature the permission serves.
    pub feature: &'static str,
    /// The screen-contract element whose tap is the only thing that may ask (REQ-PRV-003).
    pub control: &'static str,
    /// Locale key of the priming title.
    pub priming_title: &'static str,
    /// Locale key of the priming body: what the feature does with it, and that it is optional.
    pub priming_body: &'static str,
    /// Locale key of the purpose string the system prompt shows (`NS…UsageDescription` on iOS).
    pub purpose: &'static str,
    /// Locale key of the inline note after a permanent refusal (REQ-PRV-004).
    pub settings_note: &'static str,
    pub fallback: PermissionFallback,
    /// `uses-permission` names in `AndroidManifest.xml` (REQ-PRV-005).
    pub android_permissions: &'static [&'static str],
    /// Usage-description keys in the iOS `Info.plist`; each one's value is the purpose string.
    pub ios_usage_descriptions: &'static [&'static str],
}

impl Permission {
    /// Every locale key the entry names.
    pub fn locale_keys(&self) -> [&'static str; 4] {
        [
            self.priming_title,
            self.priming_body,
            self.purpose,
            self.settings_note,
        ]
    }
}

/// "Use my location" fills the country on the eligibility screen: coarse, while in use, one fix
/// (REQ-PRV-006).
pub const LOCATION_APPROXIMATE: Permission = Permission {
    id: PermissionId::LocationApproximate,
    feature: "country_from_location",
    control: "use-location-button",
    priming_title: "eligibility.location.primingTitle",
    priming_body: "eligibility.location.primingBody",
    purpose: "eligibility.location.purpose",
    settings_note: "eligibility.location.settingsNote",
    fallback: PermissionFallback::KeepManualEntry,
    android_permissions: &["android.permission.ACCESS_COARSE_LOCATION"],
    ios_usage_descriptions: &["NSLocationWhenInUseUsageDescription"],
};

/// Every permission the apps may ask for, in [`PermissionId::ALL`] order.
pub const PERMISSIONS: [Permission; 1] = [LOCATION_APPROXIMATE];

/// The next step after a tap on the control that needs a permission (REQ-PRV-002).
///
/// `primed` is whether the person has just read the priming and chosen "Continue". A refusal the
/// system can still ask about (`Denied`, Android) is explained again before asking again; after
/// that explanation the system prompt is shown, because Android allows it.
pub fn permission_step(status: PermissionStatus, primed: bool) -> PermissionStep {
    match status {
        PermissionStatus::NotDetermined | PermissionStatus::Denied if !primed => {
            PermissionStep::ShowPriming
        }
        PermissionStatus::NotDetermined | PermissionStatus::Denied => PermissionStep::RequestSystem,
        PermissionStatus::Granted | PermissionStatus::GrantedApproximate => {
            PermissionStep::UseFeature
        }
        PermissionStatus::DeniedPermanently | PermissionStatus::Restricted => {
            PermissionStep::OfferSettings
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::screens::{unique_elements, ElementKind, Platform};
    use crate::test_support::missing_in_locales;

    #[test]
    fn the_catalogue_follows_the_id_order_and_names_each_id_once() {
        // Verifies: REQ-PRV-001
        let ids: Vec<PermissionId> = PERMISSIONS.iter().map(|p| p.id).collect();
        assert_eq!(ids, PermissionId::ALL);
        for id in PermissionId::ALL {
            assert_eq!(id.entry().id, id);
            assert_eq!(serde_json::to_value(id).unwrap(), id.as_str());
        }
    }

    #[test]
    fn every_key_of_every_entry_exists_in_every_locale() {
        // Verifies: REQ-PRV-001
        for permission in PERMISSIONS {
            let missing = missing_in_locales(permission.locale_keys());
            assert!(missing.is_empty(), "{:?}: {missing:?}", permission.id);
        }
    }

    #[test]
    fn an_entry_whose_key_is_missing_from_a_locale_is_rejected() {
        // Verifies: REQ-PRV-001
        let broken = Permission {
            priming_body: "eligibility.location.noSuchKey",
            ..LOCATION_APPROXIMATE
        };
        let missing = missing_in_locales(broken.locale_keys());
        assert_eq!(missing.len(), 3, "{missing:?}");
        assert!(missing
            .iter()
            .all(|(_, key)| key == "eligibility.location.noSuchKey"));
    }

    #[test]
    fn every_control_is_a_native_button_of_the_screen_contract() {
        // Verifies: REQ-PRV-003 REQ-PRV-007 — the web asks for no permission.
        for permission in PERMISSIONS {
            let control = unique_elements()
                .into_iter()
                .find(|e| e.id == permission.control)
                .unwrap();
            assert_eq!(control.kind, ElementKind::Button);
            assert_eq!(control.platforms, [Platform::Ios, Platform::Android]);
            let declarations =
                permission.android_permissions.len() + permission.ios_usage_descriptions.len();
            assert!(declarations > 0, "{:?} is declared nowhere", permission.id);
        }
    }

    #[test]
    fn location_asks_for_the_least_it_needs() {
        // Verifies: REQ-PRV-006
        let location = PermissionId::LocationApproximate.entry();
        assert_eq!(
            location.android_permissions,
            ["android.permission.ACCESS_COARSE_LOCATION"]
        );
        assert_eq!(
            location.ios_usage_descriptions,
            ["NSLocationWhenInUseUsageDescription"]
        );
        assert_eq!(location.fallback, PermissionFallback::KeepManualEntry);
        assert_eq!(location.fallback.as_str(), "keep_manual_entry");
    }

    #[test]
    fn the_step_table_matches_the_spec() {
        // Verifies: REQ-PRV-002
        use PermissionStatus as S;
        use PermissionStep as P;
        let table = [
            (S::NotDetermined, false, P::ShowPriming),
            (S::NotDetermined, true, P::RequestSystem),
            (S::Granted, false, P::UseFeature),
            (S::Granted, true, P::UseFeature),
            (S::GrantedApproximate, false, P::UseFeature),
            (S::GrantedApproximate, true, P::UseFeature),
            (S::Denied, false, P::ShowPriming),
            (S::Denied, true, P::RequestSystem),
            (S::DeniedPermanently, false, P::OfferSettings),
            (S::DeniedPermanently, true, P::OfferSettings),
            (S::Restricted, false, P::OfferSettings),
            (S::Restricted, true, P::OfferSettings),
        ];
        for (status, primed, step) in table {
            assert_eq!(permission_step(status, primed), step, "{status:?} {primed}");
        }
    }

    #[test]
    fn names_are_snake_case_and_match_serde() {
        // Verifies: REQ-PRV-002
        let statuses: Vec<&str> = PermissionStatus::ALL.map(PermissionStatus::as_str).to_vec();
        assert_eq!(
            statuses,
            [
                "not_determined",
                "granted",
                "granted_approximate",
                "denied",
                "denied_permanently",
                "restricted"
            ]
        );
        let steps: Vec<&str> = PermissionStep::ALL.map(PermissionStep::as_str).to_vec();
        assert_eq!(
            steps,
            [
                "show_priming",
                "request_system",
                "use_feature",
                "offer_settings"
            ]
        );
        for status in PermissionStatus::ALL {
            assert_eq!(serde_json::to_value(status).unwrap(), status.as_str());
        }
        for step in PermissionStep::ALL {
            assert_eq!(serde_json::to_value(step).unwrap(), step.as_str());
        }
        assert_eq!(
            serde_json::to_value(PermissionFallback::KeepManualEntry).unwrap(),
            "keep_manual_entry"
        );
    }
}
