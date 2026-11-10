//! The permission catalogue, the next-step decision and the personal questions for native apps
//! (spec 026, ADR-0043).
//!
//! Swift and Kotlin read the catalogue for copy and declarations and call [`permission_step`] on
//! every tap of a control that needs a permission, so the apps implement only the gateway that
//! talks to the operating system, never the policy.

use rust_core::permissions::{
    self, Permission, PermissionFallback, PermissionId, PermissionStatus, PermissionStep,
    PERMISSIONS,
};
use rust_core::personal_questions::{AnswerKind, PersonalQuestion, PERSONAL_QUESTIONS};

/// A permission the apps may ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranPermissionId {
    /// Approximate location while in use, read once to fill the country (REQ-PRV-006).
    LocationApproximate,
}

/// What the platform reports for a permission, mapped by the app's gateway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranPermissionStatus {
    /// The system prompt has not been shown.
    NotDetermined,
    /// Granted as asked.
    Granted,
    /// Granted with reduced accuracy (iOS approximate, Android coarse).
    GrantedApproximate,
    /// Refused, but the system can still ask again (Android before the second refusal).
    Denied,
    /// Refused for good: only Settings can change it.
    DeniedPermanently,
    /// The person cannot grant it (parental controls, device management).
    Restricted,
}

/// What the app does next after a tap on the control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranPermissionStep {
    /// Show the app's own explanation with "Continue" and "Not now".
    ShowPriming,
    /// Show the system prompt (only after "Continue").
    RequestSystem,
    /// Go on with the feature.
    UseFeature,
    /// Show the inline Settings note once; never ask again.
    OfferSettings,
}

/// What the feature does without the permission; never an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranPermissionFallback {
    /// The value stays entered by hand (the country stays hand-picked).
    KeepManualEntry,
}

/// One catalogue entry: copy as locale keys, and what each platform declares for it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranPermission {
    /// Which permission.
    pub id: TranPermissionId,
    /// Snake-case name of the feature it serves (`country_from_location`).
    pub feature: String,
    /// Screen-contract element id of the only control that may ask (`ScreenContract`).
    pub control: String,
    /// Locale key of the priming title.
    pub priming_title_key: String,
    /// Locale key of the priming body.
    pub priming_body_key: String,
    /// Locale key of the purpose string the system prompt shows.
    pub purpose_key: String,
    /// Locale key of the inline note after a permanent refusal.
    pub settings_note_key: String,
    /// What the feature does without it.
    pub fallback: TranPermissionFallback,
    /// `uses-permission` names the Android manifest declares for it.
    pub android_permissions: Vec<String>,
    /// Usage-description keys the iOS `Info.plist` declares for it.
    pub ios_usage_descriptions: Vec<String>,
}

/// What an answer to a personal question means.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranAnswerKind {
    /// One of the listed choices.
    Choice,
    /// The person describes it in their own words.
    SelfDescribed,
    /// The person declines; store it as no answer.
    PreferNotToSay,
}

/// One answer a personal question offers.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranPersonalAnswer {
    /// Stable snake-case id the app stores.
    pub id: String,
    /// What the answer means.
    pub kind: TranAnswerKind,
    /// Locale key of its label.
    pub label_key: String,
}

/// One optional question about the person (REQ-PRV-008).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranPersonalQuestion {
    /// Stable snake-case id (`gender`).
    pub id: String,
    /// Snake-case name of the feature that needs the answer.
    pub feature: String,
    /// Locale key of the question's label.
    pub label_key: String,
    /// The answers, in display order; always including "Prefer not to say".
    pub answers: Vec<TranPersonalAnswer>,
    /// The requirement id that makes an answer necessary; `None` when it can be skipped.
    pub required_by: Option<String>,
}

impl From<PermissionId> for TranPermissionId {
    fn from(id: PermissionId) -> Self {
        match id {
            PermissionId::LocationApproximate => Self::LocationApproximate,
        }
    }
}

impl From<TranPermissionId> for PermissionId {
    fn from(id: TranPermissionId) -> Self {
        match id {
            TranPermissionId::LocationApproximate => Self::LocationApproximate,
        }
    }
}

impl From<TranPermissionStatus> for PermissionStatus {
    fn from(status: TranPermissionStatus) -> Self {
        match status {
            TranPermissionStatus::NotDetermined => Self::NotDetermined,
            TranPermissionStatus::Granted => Self::Granted,
            TranPermissionStatus::GrantedApproximate => Self::GrantedApproximate,
            TranPermissionStatus::Denied => Self::Denied,
            TranPermissionStatus::DeniedPermanently => Self::DeniedPermanently,
            TranPermissionStatus::Restricted => Self::Restricted,
        }
    }
}

impl From<PermissionStep> for TranPermissionStep {
    fn from(step: PermissionStep) -> Self {
        match step {
            PermissionStep::ShowPriming => Self::ShowPriming,
            PermissionStep::RequestSystem => Self::RequestSystem,
            PermissionStep::UseFeature => Self::UseFeature,
            PermissionStep::OfferSettings => Self::OfferSettings,
        }
    }
}

impl From<Permission> for TranPermission {
    fn from(permission: Permission) -> Self {
        let strings = |items: &[&str]| items.iter().map(|item| item.to_string()).collect();
        Self {
            id: permission.id.into(),
            feature: permission.feature.into(),
            control: permission.control.into(),
            priming_title_key: permission.priming_title.into(),
            priming_body_key: permission.priming_body.into(),
            purpose_key: permission.purpose.into(),
            settings_note_key: permission.settings_note.into(),
            fallback: match permission.fallback {
                PermissionFallback::KeepManualEntry => TranPermissionFallback::KeepManualEntry,
            },
            android_permissions: strings(permission.android_permissions),
            ios_usage_descriptions: strings(permission.ios_usage_descriptions),
        }
    }
}

impl From<PersonalQuestion> for TranPersonalQuestion {
    fn from(question: PersonalQuestion) -> Self {
        Self {
            id: question.id.into(),
            feature: question.feature.into(),
            label_key: question.label.into(),
            answers: question
                .answers
                .iter()
                .map(|answer| TranPersonalAnswer {
                    id: answer.id.into(),
                    kind: match answer.kind {
                        AnswerKind::Choice => TranAnswerKind::Choice,
                        AnswerKind::SelfDescribed => TranAnswerKind::SelfDescribed,
                        AnswerKind::PreferNotToSay => TranAnswerKind::PreferNotToSay,
                    },
                    label_key: answer.label.into(),
                })
                .collect(),
            required_by: question.required.map(str::to_string),
        }
    }
}

/// Every permission the apps may ask for (REQ-PRV-001).
///
/// # Returns
///
/// The catalogue from `rust-core`, in a stable order; pinned by the `permissions` section of
/// `fixtures/permissions.json`.
#[uniffi::export]
pub fn permission_catalogue() -> Vec<TranPermission> {
    PERMISSIONS.into_iter().map(TranPermission::from).collect()
}

/// One permission's catalogue entry.
///
/// # Arguments
///
/// * `id` — the permission.
///
/// # Returns
///
/// Its copy keys, fallback and declarations.
#[uniffi::export]
pub fn permission_entry(id: TranPermissionId) -> TranPermission {
    PermissionId::from(id).entry().into()
}

/// What to do after a tap on the control that needs a permission (REQ-PRV-002).
///
/// # Arguments
///
/// * `status` — what the platform reports now, mapped by the gateway.
/// * `primed` — whether the person has just chosen "Continue" on the priming.
///
/// # Returns
///
/// [`TranPermissionStep::ShowPriming`] before a first ask (or again after a refusal Android can
/// still ask about), [`TranPermissionStep::RequestSystem`] only after priming,
/// [`TranPermissionStep::UseFeature`] when granted, and [`TranPermissionStep::OfferSettings`]
/// after a permanent refusal or a restriction.
#[uniffi::export]
pub fn permission_step(status: TranPermissionStatus, primed: bool) -> TranPermissionStep {
    permissions::permission_step(status.into(), primed).into()
}

/// Every personal question the apps may ask (REQ-PRV-008).
///
/// # Returns
///
/// The catalogue from `rust-core`; every question offers "Prefer not to say" and is skippable
/// unless `required_by` names a requirement.
#[uniffi::export]
pub fn personal_questions() -> Vec<TranPersonalQuestion> {
    PERSONAL_QUESTIONS
        .into_iter()
        .map(TranPersonalQuestion::from)
        .collect()
}
