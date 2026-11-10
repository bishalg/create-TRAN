//! The four screens every platform implements, and the elements each must offer (REQ-SCR-001).
//!
//! An element shared by two screens (sign out, delete account, the confirmation dialogs' buttons, the
//! role badge) is declared once below and listed on each screen, so one id always means one element.

use super::model::{
    Element, ElementKind as Kind, Platform, Presence, Screen, TouchClass as Touch, UnreachedState,
};
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
        platforms: &Platform::ALL,
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
    /// The account-deletion confirmation is open (REQ-ACC-005).
    pub const DELETE_ACCOUNT_CONFIRM: &str = "delete_account_confirm";
    /// The last check was refused because an input did not parse (REQ-WEB-002, REQ-NAT-002).
    pub const VALIDATION_FAILED: &str = "validation_failed";
    /// The app explains location before the system prompt (REQ-PRV-003).
    pub const LOCATION_PRIMING: &str = "location_priming";
    /// Location was refused for good; the control says once where to change it (REQ-PRV-004).
    pub const LOCATION_SETTINGS_OFFERED: &str = "location_settings_offered";
}

/// iOS and Android: the platforms that ask the system for a permission. The web has no location
/// control, because the API resolves the country from the request (REQ-API-005, REQ-PRV-007).
const NATIVE: &[Platform] = &[Platform::Ios, Platform::Android];

/// States no scenario reaches yet. `pnpm screens:check` lists them instead of failing "never
/// observed"; `crates/rust-core/src/screens/tests.rs` fails once a scenario expects one, so the
/// entry goes when the gap closes (REQ-SCR-008).
pub const UNREACHED_STATES: [UnreachedState; 1] = [UnreachedState {
    state: state::TOAST_SHOWN,
    reason: "a toast acknowledges a server answer: the web's device check never calls the server \
             (REQ-WEB-001) and the verb set has no given for its server mode, and the native \
             suites run without an API",
}];

/// The web's own: WCAG 2.4.1 asks a web page for a way past repeated blocks (REQ-A11Y-010); an
/// app screen has none to skip, so iOS and Android do not offer it.
pub const SKIP_LINK: Element = element(
    "skip-link",
    Kind::Button,
    "shell.skipToContent",
    Touch::Control,
    Presence::Always,
)
.only(&[Platform::Web]);
/// The web's own: a browser tab chooses its language in the page (REQ-I18N-006, REQ-A11Y-006);
/// iOS and Android follow the system's per-app language setting instead.
pub const LANGUAGE_PICKER: Element = element(
    "language-picker",
    Kind::Segmented,
    "shell.language.label",
    Touch::Control,
    Presence::Always,
)
.only(&[Platform::Web]);
/// The web's own: it runs the check on the device or by the server, as a person chooses
/// (REQ-WEB-001). The native apps check on the device and confirm with the server in the
/// background (REQ-NAT-011), so there is nothing to choose.
pub const MODE_SWITCH: Element = element(
    "mode-switch",
    Kind::Segmented,
    "eligibility.mode.legend",
    Touch::Control,
    Presence::Always,
)
.only(&[Platform::Web]);

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
/// Beside sign-out on every signed-in screen, never a link out of the app (REQ-ACC-004).
pub const DELETE_ACCOUNT_BUTTON: Element = element(
    "delete-account-button",
    Kind::Button,
    "common.deleteAccount",
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
/// Why the last check was refused. Separate from `offline-result`: the web announces errors through
/// `role="alert"`, never through the result's status region (REQ-A11Y-003). A live region, not a
/// text: every platform announces it when it appears (found by `pnpm screens:check`, REQ-SCR-008).
pub const VALIDATION_MESSAGE: Element = element(
    "validation-message",
    Kind::LiveRegion,
    "eligibility.validation.label",
    Touch::None,
    Presence::When(state::VALIDATION_FAILED),
);
pub const VERDICT_SOURCE: Element = element(
    "verdict-source",
    Kind::Text,
    "eligibility.result.source",
    Touch::None,
    Presence::When(state::VERDICT_SHOWN),
);
/// One option per registry theme. Each option is addressed as `<this id>-<theme mode>` (the dark
/// option is `theme-picker-dark`), derived at run time by the platform and by every interpreter's
/// `select` step from this id and the option name, never spelled out in code (ADR-0038).
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
/// The deletion dialog's own buttons: its confirm names the action, not "Sign out" (REQ-ACC-005),
/// so they are not the sign-out dialog's `dialog-confirm` and `dialog-cancel`.
pub const DELETE_ACCOUNT_CONFIRM: Element = element(
    "delete-account-confirm",
    Kind::Button,
    "common.deleteAccount",
    Touch::Control,
    Presence::When(state::DELETE_ACCOUNT_CONFIRM),
);
pub const DELETE_ACCOUNT_CANCEL: Element = element(
    "delete-account-cancel",
    Kind::Button,
    "common.cancel",
    Touch::Control,
    Presence::When(state::DELETE_ACCOUNT_CONFIRM),
);

/// Fills `country-field` from one approximate fix, after priming (REQ-PRV-003, REQ-PRV-006).
/// Native only: see [`NATIVE`].
pub const USE_LOCATION_BUTTON: Element = element(
    "use-location-button",
    Kind::Button,
    "eligibility.location.use",
    Touch::Control,
    Presence::Always,
)
.only(NATIVE);
/// Priming's "Continue": only this shows the system prompt.
pub const LOCATION_PRIMING_CONTINUE: Element = element(
    "location-priming-continue",
    Kind::Button,
    "common.continueAction",
    Touch::Control,
    Presence::When(state::LOCATION_PRIMING),
)
.only(NATIVE);
/// Priming's "Not now": closes it; no system prompt, not a refusal.
pub const LOCATION_PRIMING_DISMISS: Element = element(
    "location-priming-dismiss",
    Kind::Button,
    "common.notNow",
    Touch::Control,
    Presence::When(state::LOCATION_PRIMING),
)
.only(NATIVE);
/// The one inline note after a permanent refusal: not an error, not a banner.
pub const LOCATION_SETTINGS_NOTE: Element = element(
    "location-settings-note",
    Kind::Text,
    "eligibility.location.settingsNote",
    Touch::None,
    Presence::When(state::LOCATION_SETTINGS_OFFERED),
)
.only(NATIVE);
pub const LOCATION_OPEN_SETTINGS: Element = element(
    "location-open-settings",
    Kind::Button,
    "common.openSettings",
    Touch::Control,
    Presence::When(state::LOCATION_SETTINGS_OFFERED),
)
.only(NATIVE);

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
        elements: &[
            VOTER_BRANCH_BUTTON,
            AUDITOR_BRANCH_BUTTON,
            SKIP_LINK,
            LANGUAGE_PICKER,
        ],
        scenarios: scenarios::AUTH_WELCOME,
    },
    Screen {
        id: "eligibility",
        destination: AppDestination::VoterDashboard,
        intent: "screen.eligibility.intent",
        elements: &[
            SIGN_OUT_BUTTON,
            DELETE_ACCOUNT_BUTTON,
            ROLE_BADGE,
            AGE_FIELD,
            COUNTRY_FIELD,
            USE_LOCATION_BUTTON,
            LOCATION_PRIMING_CONTINUE,
            LOCATION_PRIMING_DISMISS,
            LOCATION_SETTINGS_NOTE,
            LOCATION_OPEN_SETTINGS,
            CHECK_BUTTON,
            OFFLINE_RESULT,
            VALIDATION_MESSAGE,
            VERDICT_SOURCE,
            THEME_PICKER,
            API_STATUS,
            OFFLINE_NOTICE,
            TOAST,
            TOAST_DISMISS,
            DIALOG_CONFIRM,
            DIALOG_CANCEL,
            DELETE_ACCOUNT_CONFIRM,
            DELETE_ACCOUNT_CANCEL,
            SKIP_LINK,
            LANGUAGE_PICKER,
            MODE_SWITCH,
        ],
        scenarios: scenarios::ELIGIBILITY,
    },
    Screen {
        id: "auditor",
        destination: AppDestination::AuditorDashboard,
        intent: "screen.auditor.intent",
        elements: &[
            SIGN_OUT_BUTTON,
            DELETE_ACCOUNT_BUTTON,
            ROLE_BADGE,
            DIALOG_CONFIRM,
            DIALOG_CANCEL,
            DELETE_ACCOUNT_CONFIRM,
            DELETE_ACCOUNT_CANCEL,
            SKIP_LINK,
            LANGUAGE_PICKER,
        ],
        scenarios: scenarios::AUDITOR,
    },
];
