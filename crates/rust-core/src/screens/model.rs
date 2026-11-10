//! The vocabulary of the screen contract (ADR-0038, spec 021): screens, their elements, the
//! scenarios that prove them and the per-platform minimums. Everything here is semantic; nothing
//! can say how an element looks (REQ-SCR-003).

use crate::feedback::{LOADING_POLICY, SERVER_DEADLINE_MS};
use crate::navigation::AppDestination;
use crate::permissions::{PermissionId, PermissionStatus};
use serde::{Serialize, Serializer};

/// One destination's user-facing surface (REQ-SCR-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Screen {
    /// Stable snake_case name (`auth_welcome`).
    pub id: &'static str,
    #[serde(serialize_with = "destination_name")]
    pub destination: AppDestination,
    /// Locale key (`screen.<camelCaseId>.intent`) of the one-sentence purpose of the screen.
    pub intent: &'static str,
    pub elements: &'static [Element],
    pub scenarios: &'static [Scenario],
}

fn destination_name<S: Serializer>(
    destination: &AppDestination,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(destination.as_str())
}

/// A named part of a screen a person or a test can address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Element {
    /// Kebab-case; the one name behind `data-testid`, `accessibilityIdentifier` and `testTag`.
    pub id: &'static str,
    pub kind: ElementKind,
    /// Locale key of the element's accessible name. For an element that carries changing content
    /// (a text, a live region, a banner, a toast) it names that content: "Role", then the role.
    pub label: &'static str,
    pub touch: TouchClass,
    pub presence: Presence,
    /// The platforms that offer the element: every platform unless the catalogue says why one
    /// does not (REQ-SCR-008), so the conformance check knows a deliberate difference from a gap.
    pub platforms: &'static [Platform],
}

impl Element {
    /// The same element, offered only on `platforms`. The catalogue says why beside each use.
    pub const fn only(self, platforms: &'static [Platform]) -> Self {
        Self { platforms, ..self }
    }

    pub fn is_on(&self, platform: Platform) -> bool {
        self.platforms.contains(&platform)
    }
}

/// What an element is, never how it looks (REQ-SCR-003).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    Field,
    Button,
    Text,
    LiveRegion,
    Banner,
    Toast,
    Dialog,
    Segmented,
    Progress,
}

impl ElementKind {
    pub const ALL: [Self; 9] = [
        Self::Field,
        Self::Button,
        Self::Text,
        Self::LiveRegion,
        Self::Banner,
        Self::Toast,
        Self::Dialog,
        Self::Segmented,
        Self::Progress,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Field => "field",
            Self::Button => "button",
            Self::Text => "text",
            Self::LiveRegion => "live_region",
            Self::Banner => "banner",
            Self::Toast => "toast",
            Self::Dialog => "dialog",
            Self::Segmented => "segmented",
            Self::Progress => "progress",
        }
    }
}

/// Which touch minimum an element resolves to on each platform (REQ-SCR-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TouchClass {
    /// Something a person operates: the platform's control minimum.
    Control,
    /// The screen's main action: the platform's primary-action minimum (larger on the web).
    Primary,
    /// Not operable; no minimum.
    None,
}

impl TouchClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Primary => "primary",
            Self::None => "none",
        }
    }
}

/// When an element must be on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Presence {
    Always,
    /// Only while the named state holds (`api_unreachable`).
    When(&'static str),
}

/// A stored session, named as in `fixtures/navigation.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    None,
    Unauthenticated,
    CitizenVoter,
    ElectionAuditor,
}

/// A named placeholder value of a locale string (`{age}` → `20`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Arg {
    pub name: &'static str,
    pub value: &'static str,
}

/// The state a scenario starts from. A closed set: a new verb is an ADR (ADR-0038).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Given {
    Session(SessionKind),
    ApiReachable,
    ApiUnreachable,
    Locale(&'static str),
    Theme(&'static str),
    LargestTextScale,
    ReducedMotion,
    /// The platform reports `status` for permission `id` (REQ-PRV-004). Native only: the
    /// interpreters stage it through the app's fake permission gateway, never a system prompt.
    Permission {
        id: PermissionId,
        status: PermissionStatus,
    },
    /// The API no longer serves this app version (REQ-VER-009): once the scenario's starting state
    /// is on screen (the minimum is raised while the app is open), every product route answers
    /// `426 client.upgrade_required` in the envelope; health still answers.
    UpgradeRequired,
}

/// What the person does. A closed set (ADR-0038).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum When {
    Tap(&'static str),
    Type {
        id: &'static str,
        text: &'static str,
    },
    Select {
        id: &'static str,
        option: &'static str,
    },
    PressKey {
        id: &'static str,
        key: &'static str,
    },
    GoOffline,
    GoOnline,
}

/// What must then be true. A closed set (ADR-0038).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Then {
    Exists(&'static str),
    Missing(&'static str),
    /// The element reads the locale string `key` with `args`, resolved in the scenario's locale.
    TextIs {
        id: &'static str,
        key: &'static str,
        args: &'static [Arg],
    },
    HasFocus(&'static str),
    /// The live region `id` announces the locale string `key` with `args`.
    Announced {
        id: &'static str,
        key: &'static str,
        args: &'static [Arg],
    },
    Count {
        id: &'static str,
        n: u32,
    },
}

impl Given {
    pub const VERBS: [&'static str; 9] = [
        "session",
        "api_reachable",
        "api_unreachable",
        "locale",
        "theme",
        "largest_text_scale",
        "reduced_motion",
        "permission",
        "upgrade_required",
    ];

    pub fn verb(self) -> &'static str {
        match self {
            Self::Session(_) => Self::VERBS[0],
            Self::ApiReachable => Self::VERBS[1],
            Self::ApiUnreachable => Self::VERBS[2],
            Self::Locale(_) => Self::VERBS[3],
            Self::Theme(_) => Self::VERBS[4],
            Self::LargestTextScale => Self::VERBS[5],
            Self::ReducedMotion => Self::VERBS[6],
            Self::Permission { .. } => Self::VERBS[7],
            Self::UpgradeRequired => Self::VERBS[8],
        }
    }

    /// The platforms that can stage the given: a permission status only natively, because the
    /// web asks for no permission (REQ-PRV-007).
    pub fn platforms(self) -> &'static [Platform] {
        match self {
            Self::Permission { .. } => &[Platform::Ios, Platform::Android],
            _ => &Platform::ALL,
        }
    }
}

impl When {
    pub const VERBS: [&'static str; 6] = [
        "tap",
        "type",
        "select",
        "press_key",
        "go_offline",
        "go_online",
    ];

    pub fn verb(self) -> &'static str {
        match self {
            Self::Tap(_) => Self::VERBS[0],
            Self::Type { .. } => Self::VERBS[1],
            Self::Select { .. } => Self::VERBS[2],
            Self::PressKey { .. } => Self::VERBS[3],
            Self::GoOffline => Self::VERBS[4],
            Self::GoOnline => Self::VERBS[5],
        }
    }

    /// The element the step acts on, if any.
    pub fn element(self) -> Option<&'static str> {
        match self {
            Self::Tap(id)
            | Self::Type { id, .. }
            | Self::Select { id, .. }
            | Self::PressKey { id, .. } => Some(id),
            Self::GoOffline | Self::GoOnline => None,
        }
    }
}

impl Then {
    pub const VERBS: [&'static str; 6] = [
        "exists",
        "missing",
        "text_is",
        "has_focus",
        "announced",
        "count",
    ];

    pub fn verb(self) -> &'static str {
        match self {
            Self::Exists(_) => Self::VERBS[0],
            Self::Missing(_) => Self::VERBS[1],
            Self::TextIs { .. } => Self::VERBS[2],
            Self::HasFocus(_) => Self::VERBS[3],
            Self::Announced { .. } => Self::VERBS[4],
            Self::Count { .. } => Self::VERBS[5],
        }
    }

    /// The element the expectation is about.
    pub fn element(self) -> &'static str {
        match self {
            Self::Exists(id)
            | Self::Missing(id)
            | Self::TextIs { id, .. }
            | Self::HasFocus(id)
            | Self::Announced { id, .. }
            | Self::Count { id, .. } => id,
        }
    }

    /// The locale string and its arguments, for `text_is` and `announced`.
    pub fn message(self) -> Option<(&'static str, &'static [Arg])> {
        match self {
            Self::TextIs { key, args, .. } | Self::Announced { key, args, .. } => Some((key, args)),
            _ => None,
        }
    }
}

/// The longest any scenario may take: the waiting indicator's delay plus the server's deadline
/// (REQ-SCR-004). Past it, the person has either an answer or the device's fallback.
pub const SCENARIO_BOUND_MS: u64 = LOADING_POLICY.indicator_delay_ms + SERVER_DEADLINE_MS;

/// An executable acceptance criterion (REQ-SCR-004).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Scenario {
    pub name: &'static str,
    /// Requirement ids this scenario proves; at least one.
    pub verifies: &'static [&'static str],
    pub given: &'static [Given],
    pub when: &'static [When],
    pub then: &'static [Then],
    pub within_ms: u64,
}

impl Scenario {
    /// A scenario with the default time bound, [`SCENARIO_BOUND_MS`].
    pub const fn new(
        name: &'static str,
        verifies: &'static [&'static str],
        given: &'static [Given],
        when: &'static [When],
        then: &'static [Then],
    ) -> Self {
        Self {
            name,
            verifies,
            given,
            when,
            then,
            within_ms: SCENARIO_BOUND_MS,
        }
    }
}

/// A platform the contract is generated to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Web,
    Ios,
    Android,
}

impl Platform {
    pub const ALL: [Self; 3] = [Self::Web, Self::Ios, Self::Android];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Ios => "ios",
            Self::Android => "android",
        }
    }
}

/// The largest text setting a platform offers, in the platform's own terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TextScale {
    /// A multiple of the default text, in percent (web zoom; Android `fontScale` × 100).
    Percent(u16),
    /// A named content size category (iOS).
    Category(&'static str),
}

/// What a touch class and the largest text scale resolve to on one platform (REQ-SCR-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PlatformMinimum {
    pub platform: Platform,
    /// `css_px`, `pt` or `dp`.
    pub unit: &'static str,
    /// Minimum target for a [`TouchClass::Control`], on both axes.
    pub control: u16,
    /// Minimum target for a [`TouchClass::Primary`], on both axes.
    pub primary_action: u16,
    pub largest_text_scale: TextScale,
}

impl PlatformMinimum {
    /// The minimum for `touch`, or `None` when the element is not operable.
    pub fn for_touch(&self, touch: TouchClass) -> Option<u16> {
        match touch {
            TouchClass::Control => Some(self.control),
            TouchClass::Primary => Some(self.primary_action),
            TouchClass::None => None,
        }
    }
}

/// The only place these numbers live; every platform's tests read them from the generated contract.
pub const PLATFORM_MINIMUMS: [PlatformMinimum; 3] = [
    // WCAG 2.2 target size (minimum) is 24 CSS px; the primary action meets the enhanced 44.
    PlatformMinimum {
        platform: Platform::Web,
        unit: "css_px",
        control: 24,
        primary_action: 44,
        largest_text_scale: TextScale::Percent(200),
    },
    // Apple Human Interface Guidelines.
    PlatformMinimum {
        platform: Platform::Ios,
        unit: "pt",
        control: 44,
        primary_action: 44,
        largest_text_scale: TextScale::Category("UICTContentSizeCategoryAccessibilityXXXL"),
    },
    // Material Design and Android accessibility guidance.
    PlatformMinimum {
        platform: Platform::Android,
        unit: "dp",
        control: 48,
        primary_action: 48,
        largest_text_scale: TextScale::Percent(200),
    },
];

/// A state an element depends on that no scenario reaches yet, and why (REQ-SCR-008). The
/// conformance check reports it instead of failing "never observed".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct UnreachedState {
    pub state: &'static str,
    pub reason: &'static str,
}

/// Everything the codegen emits, in one serializable value (`pnpm tokens:sync`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ScreensJsonSnapshot {
    pub screens: &'static [Screen],
    pub platform_minimums: &'static [PlatformMinimum],
    pub scenario_bound_ms: u64,
    pub unreached_states: &'static [UnreachedState],
}
