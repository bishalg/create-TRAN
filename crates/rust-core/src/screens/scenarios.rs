//! Acceptance criteria as data (REQ-SCR-004): the journeys all three platforms share today, taken
//! from `VotingUITests.swift`, `VotingHomeAccessibilityTest.kt`, `e2e/maestro/flows` and
//! `e2e/features`. Each cites the requirements those tests cite.
//!
//! `type` replaces a field's content. Ids are the catalogue's; a journey may cross screens (sign out
//! ends on role selection), so the steps may name any screen's elements.

use super::model::{
    Arg, Given, Scenario, SessionKind,
    Then::{self, Count, Exists, Missing, TextIs},
    When::{self, Tap},
};

const VOTER: Given = Given::Session(SessionKind::CitizenVoter);
const CHECK: When = Tap("check-button");
const MEETS: &str = "eligibility.result.reasonMeets";
const BELOW: &str = "eligibility.result.reasonBelow";

// Macros, not `const fn`s: a borrow of a function call's result is not promoted to `'static`, a
// borrow of a literal is.
macro_rules! age {
    ($text:literal) => {
        When::Type {
            id: "age-field",
            text: $text,
        }
    };
}

macro_rules! country {
    ($text:literal) => {
        When::Type {
            id: "country-field",
            text: $text,
        }
    };
}

/// `offline-result` reads `key` with `{age}`, `{minimumAge}` and `{country}`.
macro_rules! verdict {
    ($key:expr, $age:literal, $minimum_age:literal, $country:literal) => {
        TextIs {
            id: "offline-result",
            key: $key,
            args: &[
                Arg {
                    name: "age",
                    value: $age,
                },
                Arg {
                    name: "minimumAge",
                    value: $minimum_age,
                },
                Arg {
                    name: "country",
                    value: $country,
                },
            ],
        }
    };
}

/// Selecting a registry theme keeps the dashboard usable.
macro_rules! theme {
    ($name:literal, $theme:literal) => {
        Scenario::new(
            $name,
            &["REQ-NAT-007", "REQ-WEB-014"],
            &[VOTER],
            &[When::Select {
                id: "theme-picker",
                option: $theme,
            }],
            &[Exists("theme-picker"), Exists("check-button")],
        )
    };
}

const ELIGIBLE_CASES: &[&str] = &["REQ-NAT-001", "REQ-NAT-002", "REQ-WEB-001"];

pub const SPLASH: &[Scenario] = &[Scenario::new(
    "Without a stored session the app boots to role selection",
    &["REQ-NAV-001", "REQ-NAV-002"],
    &[Given::Session(SessionKind::None)],
    &[],
    &[
        Exists("voter-branch-button"),
        Exists("auditor-branch-button"),
    ],
)];

pub const AUTH_WELCOME: &[Scenario] = &[
    Scenario::new(
        "A signed-out person is offered both roles",
        &["REQ-NAV-002"],
        &[Given::Session(SessionKind::Unauthenticated)],
        &[],
        &[
            Exists("voter-branch-button"),
            Exists("auditor-branch-button"),
        ],
    ),
    Scenario::new(
        "Choosing Citizen Voter opens the voter dashboard",
        &["REQ-NAV-003"],
        &[Given::Session(SessionKind::Unauthenticated)],
        &[Tap("voter-branch-button")],
        &[Exists("check-button"), Exists("sign-out-button")],
    ),
    Scenario::new(
        "Choosing Election Auditor opens the auditor dashboard",
        &["REQ-NAV-004"],
        &[Given::Session(SessionKind::Unauthenticated)],
        &[Tap("auditor-branch-button")],
        &[Exists("sign-out-button"), Missing("check-button")],
    ),
];

pub const ELIGIBILITY: &[Scenario] = &[
    Scenario::new(
        "An adult in Nepal is eligible",
        ELIGIBLE_CASES,
        &[VOTER],
        &[age!("20"), country!("NP"), CHECK],
        &[verdict!(MEETS, "20", "18", "NP")],
    ),
    Scenario::new(
        "A 17 year old in the US is not eligible",
        ELIGIBLE_CASES,
        &[VOTER],
        &[age!("17"), country!("US"), CHECK],
        &[verdict!(BELOW, "17", "18", "US")],
    ),
    Scenario::new(
        "A 16 year old in Brazil is eligible",
        ELIGIBLE_CASES,
        &[VOTER],
        &[age!("16"), country!("BR"), CHECK],
        &[verdict!(MEETS, "16", "16", "BR")],
    ),
    Scenario::new(
        "Age 150 is the oldest accepted",
        ELIGIBLE_CASES,
        &[VOTER],
        &[age!("150"), country!("US"), CHECK],
        &[verdict!(MEETS, "150", "18", "US")],
    ),
    Scenario::new(
        "An unknown but well-formed country uses the default age",
        ELIGIBLE_CASES,
        &[VOTER],
        &[age!("18"), country!("ZZ"), CHECK],
        &[verdict!(MEETS, "18", "18", "ZZ")],
    ),
    // Decision (package 2, REQ-A11Y-003, REQ-WEB-002): the refusal is its own element,
    // `validation-message`, not text inside `offline-result`. The web must announce errors through
    // `role="alert"` and keep the result's status region for verdicts, so one region cannot serve
    // both there. The copy is `errors.ageOutOfRange`, the key the Rust feedback catalogue gives
    // `validation.age_out_of_range`, so every platform shows the catalogue's sentence instead of
    // its own (`errors.ageInvalid`, `errors.ageAndCountry`).
    Scenario::new(
        "An age that is not a number is explained",
        &["REQ-NAT-002", "REQ-WEB-002"],
        &[VOTER],
        &[age!("abc"), country!("NP"), CHECK],
        &[
            TextIs {
                id: "validation-message",
                key: "errors.ageOutOfRange",
                args: &[],
            },
            Missing("verdict-source"),
        ],
    ),
    // Decision (package 2, REQ-WEB-001): `verdict-source` must be shown but its copy is not pinned.
    // The native device check confirms with the server in the background, so an unreachable API
    // reads `eligibility.result.sourceFallback` there; the web's device mode never calls the server
    // (REQ-WEB-001), so it reads `eligibility.result.sourceDevice`. The fallback label stays proven
    // by the web's server-mode suite and the native tests (REQ-LOAD-005).
    Scenario::new(
        "The device verdict survives an unreachable API",
        &[
            "REQ-NAT-011",
            "REQ-WEB-004",
            "REQ-ERR-006",
            "REQ-LOAD-003",
            "REQ-LOAD-005",
        ],
        &[VOTER, Given::ApiUnreachable],
        &[age!("20"), country!("NP"), CHECK],
        &[
            Exists("offline-notice"),
            Missing("toast"),
            TextIs {
                id: "api-status",
                key: "shell.status.offline",
                args: &[],
            },
            verdict!(MEETS, "20", "18", "NP"),
            Exists("verdict-source"),
        ],
    ),
    Scenario::new(
        "The verdict is announced by the result's live region",
        &["REQ-A11Y-003", "REQ-NAT-003"],
        &[VOTER],
        &[age!("20"), country!("NP"), CHECK],
        &[Then::Announced {
            id: "offline-result",
            key: MEETS,
            args: &[
                Arg {
                    name: "age",
                    value: "20",
                },
                Arg {
                    name: "minimumAge",
                    value: "18",
                },
                Arg {
                    name: "country",
                    value: "NP",
                },
            ],
        }],
    ),
    Scenario::new(
        "The largest text scale keeps every control and the verdict reachable",
        &["REQ-NAT-004", "REQ-NAT-013", "REQ-A11Y-007"],
        &[VOTER, Given::LargestTextScale],
        &[age!("20"), country!("NP"), CHECK],
        &[
            verdict!(MEETS, "20", "18", "NP"),
            Exists("sign-out-button"),
            Exists("theme-picker"),
        ],
    ),
    Scenario::new(
        "Signing out asks first and Cancel keeps the session",
        &["REQ-ERR-007"],
        &[VOTER],
        &[Tap("sign-out-button"), Tap("dialog-cancel")],
        &[
            Missing("dialog-confirm"),
            Exists("check-button"),
            Count {
                id: "sign-out-button",
                n: 1,
            },
        ],
    ),
    Scenario::new(
        "Confirming sign-out returns to role selection",
        &["REQ-ERR-007", "REQ-NAV-005"],
        &[VOTER],
        &[Tap("sign-out-button"), Tap("dialog-confirm")],
        &[Exists("voter-branch-button"), Missing("check-button")],
    ),
    theme!("The light theme is selectable", "light"),
    theme!("The dark theme is selectable", "dark"),
    theme!("The black theme is selectable", "black"),
    theme!("The sepia theme is selectable", "sepia"),
];

pub const AUDITOR: &[Scenario] = &[Scenario::new(
    "Signing out of the auditor dashboard returns to role selection",
    &["REQ-NAV-005", "REQ-ERR-007"],
    &[Given::Session(SessionKind::ElectionAuditor)],
    &[Tap("sign-out-button"), Tap("dialog-confirm")],
    &[Exists("auditor-branch-button"), Missing("sign-out-button")],
)];
