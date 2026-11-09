//! The four screens every platform implements, and the elements each must offer (REQ-SCR-001).
//!
//! An element shared by two screens (sign out, the confirmation dialog's buttons, the role badge) is
//! declared once below and listed on each screen, so one id always means one element.

use super::model::{Element, ElementKind as Kind, Presence, Screen, TouchClass as Touch};
use super::scenarios;
use crate::navigation::AppDestination;

pub(super) const fn element(
    id: &'static str,
    kind: Kind,
    label: &'static str,
    touch: Touch,
    presence: Presence,
) -> Element {
    Element {
        id,
        kind,
        label,
        touch,
        presence,
    }
}

/// The state names conditional elements depend on.
pub mod state {
    /// A verdict (not a validation message) is on screen.
    pub const VERDICT_SHOWN: &str = "verdict_shown";
    /// The last API call failed with a banner presentation (REQ-ERR-006).
    pub const API_UNREACHABLE: &str = "api_unreachable";
    /// A toast is showing (REQ-ERR-012).
    pub const TOAST_SHOWN: &str = "toast_shown";
    /// The sign-out confirmation is open (REQ-ERR-007).
    pub const SIGN_OUT_CONFIRM: &str = "sign_out_confirm";
}

pub const SPLASH_PROGRESS: Element = element(
    "splash-progress",
    Kind::Progress,
    "common.loading",
    Touch::None,
    Presence::Always,
);
pub const VOTER_BRANCH_BUTTON: Element = element(
    "voter-branch-button",
    Kind::Button,
    "auth.continueAsVoter",
    Touch::Primary,
    Presence::Always,
);
pub const AUDITOR_BRANCH_BUTTON: Element = element(
    "auditor-branch-button",
    Kind::Button,
    "auth.continueAsAuditor",
    Touch::Control,
    Presence::Always,
);
pub const SIGN_OUT_BUTTON: Element = element(
    "sign-out-button",
    Kind::Button,
    "common.signOut",
    Touch::Control,
    Presence::Always,
);
pub const ROLE_BADGE: Element = element(
    "role-badge",
    Kind::Text,
    "common.role.label",
    Touch::None,
    Presence::Always,
);
pub const AGE_FIELD: Element = element(
    "age-field",
    Kind::Field,
    "eligibility.age.label",
    Touch::Control,
    Presence::Always,
);
pub const COUNTRY_FIELD: Element = element(
    "country-field",
    Kind::Field,
    "eligibility.country.label",
    Touch::Control,
    Presence::Always,
);
pub const CHECK_BUTTON: Element = element(
    "check-button",
    Kind::Button,
    "eligibility.checkOffline",
    Touch::Primary,
    Presence::Always,
);
pub const OFFLINE_RESULT: Element = element(
    "offline-result",
    Kind::LiveRegion,
    "eligibility.result.label",
    Touch::None,
    Presence::Always,
);
pub const VERDICT_SOURCE: Element = element(
    "verdict-source",
    Kind::Text,
    "eligibility.result.source",
    Touch::None,
    Presence::When(state::VERDICT_SHOWN),
);
pub const THEME_PICKER: Element = element(
    "theme-picker",
    Kind::Segmented,
    "shell.theme.label",
    Touch::Control,
    Presence::Always,
);
pub const API_STATUS: Element = element(
    "api-status",
    Kind::LiveRegion,
    "shell.status.label",
    Touch::None,
    Presence::Always,
);
pub const OFFLINE_NOTICE: Element = element(
    "offline-notice",
    Kind::Banner,
    "eligibility.offlineNotice",
    Touch::None,
    Presence::When(state::API_UNREACHABLE),
);
pub const TOAST: Element = element(
    "toast",
    Kind::Toast,
    "common.notifications",
    Touch::None,
    Presence::When(state::TOAST_SHOWN),
);
pub const TOAST_DISMISS: Element = element(
    "toast-dismiss",
    Kind::Button,
    "common.dismiss",
    Touch::Control,
    Presence::When(state::TOAST_SHOWN),
);
pub const DIALOG_CONFIRM: Element = element(
    "dialog-confirm",
    Kind::Button,
    "common.signOut",
    Touch::Control,
    Presence::When(state::SIGN_OUT_CONFIRM),
);
pub const DIALOG_CANCEL: Element = element(
    "dialog-cancel",
    Kind::Button,
    "common.cancel",
    Touch::Control,
    Presence::When(state::SIGN_OUT_CONFIRM),
);

/// Every screen, in navigation order. Codegen and the guards follow this order.
pub const SCREENS: [Screen; 4] = [
    Screen {
        id: "splash",
        destination: AppDestination::Splash,
        intent: "screen.splash.intent",
        elements: &[SPLASH_PROGRESS],
        scenarios: scenarios::SPLASH,
    },
    Screen {
        id: "auth_welcome",
        destination: AppDestination::AuthWelcome,
        intent: "screen.authWelcome.intent",
        elements: &[VOTER_BRANCH_BUTTON, AUDITOR_BRANCH_BUTTON],
        scenarios: scenarios::AUTH_WELCOME,
    },
    Screen {
        id: "eligibility",
        destination: AppDestination::VoterDashboard,
        intent: "screen.eligibility.intent",
        elements: &[
            SIGN_OUT_BUTTON,
            ROLE_BADGE,
            AGE_FIELD,
            COUNTRY_FIELD,
            CHECK_BUTTON,
            OFFLINE_RESULT,
            VERDICT_SOURCE,
            THEME_PICKER,
            API_STATUS,
            OFFLINE_NOTICE,
            TOAST,
            TOAST_DISMISS,
            DIALOG_CONFIRM,
            DIALOG_CANCEL,
        ],
        scenarios: scenarios::ELIGIBILITY,
    },
    Screen {
        id: "auditor",
        destination: AppDestination::AuditorDashboard,
        intent: "screen.auditor.intent",
        elements: &[SIGN_OUT_BUTTON, ROLE_BADGE, DIALOG_CONFIRM, DIALOG_CANCEL],
        scenarios: scenarios::AUDITOR,
    },
];
