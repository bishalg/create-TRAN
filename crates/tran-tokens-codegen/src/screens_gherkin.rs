//! `e2e/features/screens/<screen>.feature`: every scenario of the screen contract rendered as
//! Gherkin (ADR-0038, REQ-SCR-005). The phrasing is the interpreter's grammar: one fixed sentence
//! per verb, every id, key and value quoted, so `e2e/steps/screens.steps.ts` (and the native
//! interpreters, which read `screens.json` instead) need one definition per verb and nothing per
//! scenario.
//!
//! | verb                 | line                                                          |
//! |----------------------|---------------------------------------------------------------|
//! | `session`            | `Given the stored session is "citizen_voter"`                 |
//! | `api_reachable`      | `Given the API is reachable`                                  |
//! | `api_unreachable`    | `Given the API is unreachable`                                |
//! | `locale`             | `Given the locale is "ne"`                                    |
//! | `theme`              | `Given the theme is "dark"`                                   |
//! | `largest_text_scale` | `Given the largest text scale`                                |
//! | `reduced_motion`     | `Given reduced motion`                                        |
//! | `permission`         | `Given the permission "location_approximate" is "denied_permanently"` |
//! | `upgrade_required`   | `Given the API requires a newer app version`                  |
//! | `tap`                | `When I tap "check-button"`                                   |
//! | `type`               | `When I type "20" into "age-field"`                           |
//! | `select`             | `When I select "dark" in "theme-picker"`                      |
//! | `press_key`          | `When I press "Enter" in "age-field"`                         |
//! | `go_offline`         | `When I go offline`                                           |
//! | `go_online`          | `When I go online`                                            |
//! | `exists`             | `Then "check-button" exists`                                  |
//! | `missing`            | `Then "toast" is missing`                                     |
//! | `text_is`            | `Then "offline-result" reads "eligibility.result.reasonMeets" with age="20", minimumAge="18", country="NP"` |
//! | `has_focus`          | `Then "age-field" has focus`                                  |
//! | `announced`          | `Then "offline-result" announces "…" with age="20", …`       |
//! | `count`              | `Then "sign-out-button" count is 1`                           |
//!
//! `with …` is left out when a message has no arguments. Second and later lines of a group start
//! with `And`. The feature holds only the scenarios the web runs (`scenario_platforms`): one about
//! a native-only element (the location control, REQ-PRV-007) is in `screens.json` alone.

use rust_core::screens::{
    scenario_platforms, Arg, Given, Platform, Screen, SessionKind, Then, When,
};
use std::collections::BTreeSet;

/// `"value"`, with `\` and `"` escaped so a value can never end the quote early.
pub fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The session's name as `fixtures/navigation.json` and the JSON spell it.
pub fn session_name(kind: SessionKind) -> &'static str {
    match kind {
        SessionKind::None => "none",
        SessionKind::Unauthenticated => "unauthenticated",
        SessionKind::CitizenVoter => "citizen_voter",
        SessionKind::ElectionAuditor => "election_auditor",
    }
}

pub fn given_phrase(given: Given) -> String {
    match given {
        Given::Session(kind) => format!("the stored session is {}", quote(session_name(kind))),
        Given::ApiReachable => "the API is reachable".into(),
        Given::ApiUnreachable => "the API is unreachable".into(),
        Given::Locale(locale) => format!("the locale is {}", quote(locale)),
        Given::Theme(theme) => format!("the theme is {}", quote(theme)),
        Given::LargestTextScale => "the largest text scale".into(),
        Given::ReducedMotion => "reduced motion".into(),
        Given::Permission { id, status } => format!(
            "the permission {} is {}",
            quote(id.as_str()),
            quote(status.as_str())
        ),
        Given::UpgradeRequired => "the API requires a newer app version".into(),
    }
}

pub fn when_phrase(when: When) -> String {
    match when {
        When::Tap(id) => format!("I tap {}", quote(id)),
        When::Type { id, text } => format!("I type {} into {}", quote(text), quote(id)),
        When::Select { id, option } => format!("I select {} in {}", quote(option), quote(id)),
        When::PressKey { id, key } => format!("I press {} in {}", quote(key), quote(id)),
        When::GoOffline => "I go offline".into(),
        When::GoOnline => "I go online".into(),
    }
}

/// ` with age="20", minimumAge="18"`, or nothing for a message without placeholders.
fn with_args(args: &[Arg]) -> String {
    if args.is_empty() {
        return String::new();
    }
    let pairs: Vec<String> = args
        .iter()
        .map(|arg| format!("{}={}", arg.name, quote(arg.value)))
        .collect();
    format!(" with {}", pairs.join(", "))
}

pub fn then_phrase(then: Then) -> String {
    match then {
        Then::Exists(id) => format!("{} exists", quote(id)),
        Then::Missing(id) => format!("{} is missing", quote(id)),
        Then::TextIs { id, key, args } => {
            format!("{} reads {}{}", quote(id), quote(key), with_args(args))
        }
        Then::HasFocus(id) => format!("{} has focus", quote(id)),
        Then::Announced { id, key, args } => {
            format!("{} announces {}{}", quote(id), quote(key), with_args(args))
        }
        Then::Count { id, n } => format!("{} count is {n}", quote(id)),
    }
}

/// `    Given …` then `    And …` for the rest of the group.
fn steps(out: &mut String, keyword: &str, lines: impl IntoIterator<Item = String>) {
    for (index, line) in lines.into_iter().enumerate() {
        let keyword = if index == 0 { keyword } else { "And" };
        out.push_str(&format!("    {keyword} {line}\n"));
    }
}

pub fn render_screen_feature(screen: &Screen) -> String {
    let on_web: Vec<_> = screen
        .scenarios
        .iter()
        .filter(|scenario| scenario_platforms(scenario).contains(&Platform::Web))
        .collect();
    let cited: BTreeSet<&str> = on_web
        .iter()
        .flat_map(|scenario| scenario.verifies.iter().copied())
        .collect();
    let mut out = format!(
        "# @generated by tran-tokens-codegen from crates/rust-core/src/screens/scenarios.rs — do not edit by hand.\n\
# Run `pnpm tokens:sync` after changing a scenario (ADR-0038); e2e/steps/screens.steps.ts runs every line.\n\
# Verifies: {}\n\
Feature: {}\n",
        cited.into_iter().collect::<Vec<_>>().join(" "),
        screen.intent,
    );
    for scenario in on_web {
        let tags: Vec<String> = scenario
            .verifies
            .iter()
            .map(|id| format!("@{id}"))
            .collect();
        out.push_str(&format!(
            "\n  {}\n  Scenario: {}\n",
            tags.join(" "),
            scenario.name
        ));
        steps(
            &mut out,
            "Given",
            scenario.given.iter().map(|g| given_phrase(*g)),
        );
        steps(
            &mut out,
            "When",
            scenario.when.iter().map(|w| when_phrase(*w)),
        );
        steps(
            &mut out,
            "Then",
            scenario.then.iter().map(|t| then_phrase(*t)),
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::permissions::{PermissionId, PermissionStatus};
    use rust_core::screens::{Scenario, SCREENS};

    #[test]
    fn quotes_escape_backslashes_and_quotes() {
        assert_eq!(quote("age-field"), "\"age-field\"");
        assert_eq!(quote(r#"a"b\c"#), r#""a\"b\\c""#);
    }

    // Verifies: REQ-SCR-005 — one fixed phrasing per verb.
    #[test]
    fn every_verb_has_one_phrasing() {
        let sessions = [
            SessionKind::None,
            SessionKind::Unauthenticated,
            SessionKind::CitizenVoter,
            SessionKind::ElectionAuditor,
        ];
        let named: Vec<String> = sessions
            .map(|kind| given_phrase(Given::Session(kind)))
            .to_vec();
        assert_eq!(
            named,
            [
                "the stored session is \"none\"",
                "the stored session is \"unauthenticated\"",
                "the stored session is \"citizen_voter\"",
                "the stored session is \"election_auditor\"",
            ]
        );
        let given: Vec<String> = [
            Given::ApiReachable,
            Given::ApiUnreachable,
            Given::Locale("ne"),
            Given::Theme("dark"),
            Given::LargestTextScale,
            Given::ReducedMotion,
            Given::Permission {
                id: PermissionId::LocationApproximate,
                status: PermissionStatus::DeniedPermanently,
            },
            Given::UpgradeRequired,
        ]
        .map(given_phrase)
        .to_vec();
        assert_eq!(
            given,
            [
                "the API is reachable",
                "the API is unreachable",
                "the locale is \"ne\"",
                "the theme is \"dark\"",
                "the largest text scale",
                "reduced motion",
                "the permission \"location_approximate\" is \"denied_permanently\"",
                "the API requires a newer app version",
            ]
        );
        let when: Vec<String> = [
            When::Tap("check-button"),
            When::Type {
                id: "age-field",
                text: "20",
            },
            When::Select {
                id: "theme-picker",
                option: "dark",
            },
            When::PressKey {
                id: "age-field",
                key: "Enter",
            },
            When::GoOffline,
            When::GoOnline,
        ]
        .map(when_phrase)
        .to_vec();
        assert_eq!(
            when,
            [
                "I tap \"check-button\"",
                "I type \"20\" into \"age-field\"",
                "I select \"dark\" in \"theme-picker\"",
                "I press \"Enter\" in \"age-field\"",
                "I go offline",
                "I go online",
            ]
        );
        let args = &[
            Arg {
                name: "age",
                value: "20",
            },
            Arg {
                name: "country",
                value: "NP",
            },
        ];
        let then: Vec<String> = [
            Then::Exists("a"),
            Then::Missing("a"),
            Then::TextIs {
                id: "a",
                key: "k",
                args: &[],
            },
            Then::TextIs {
                id: "a",
                key: "k",
                args,
            },
            Then::HasFocus("a"),
            Then::Announced {
                id: "a",
                key: "k",
                args,
            },
            Then::Count { id: "a", n: 1 },
        ]
        .map(then_phrase)
        .to_vec();
        assert_eq!(
            then,
            [
                "\"a\" exists",
                "\"a\" is missing",
                "\"a\" reads \"k\"",
                "\"a\" reads \"k\" with age=\"20\", country=\"NP\"",
                "\"a\" has focus",
                "\"a\" announces \"k\" with age=\"20\", country=\"NP\"",
                "\"a\" count is 1",
            ]
        );
    }

    // Verifies: REQ-SCR-005 — tags, the header and the step keywords.
    #[test]
    fn a_feature_carries_its_header_tags_and_steps() {
        const SCENARIOS: &[Scenario] = &[Scenario::new(
            "Two steps of each kind",
            &["REQ-NAV-003", "REQ-NAV-002"],
            &[Given::ApiUnreachable, Given::ReducedMotion],
            &[When::Tap("check-button"), When::GoOffline],
            &[Then::Exists("check-button"), Then::Missing("toast")],
        )];
        let screen = Screen {
            scenarios: SCENARIOS,
            ..SCREENS[1]
        };
        let expected = [
            "# @generated by tran-tokens-codegen from crates/rust-core/src/screens/scenarios.rs — do not edit by hand.",
            "# Run `pnpm tokens:sync` after changing a scenario (ADR-0038); e2e/steps/screens.steps.ts runs every line.",
            "# Verifies: REQ-NAV-002 REQ-NAV-003",
            "Feature: screen.authWelcome.intent",
            "",
            "  @REQ-NAV-003 @REQ-NAV-002",
            "  Scenario: Two steps of each kind",
            "    Given the API is unreachable",
            "    And reduced motion",
            "    When I tap \"check-button\"",
            "    And I go offline",
            "    Then \"check-button\" exists",
            "    And \"toast\" is missing",
            "",
        ];
        assert_eq!(render_screen_feature(&screen), expected.join("\n"));
    }

    // Verifies: REQ-SCR-005 REQ-PRV-007 — every scenario the web runs, and none it cannot.
    #[test]
    fn every_screen_renders_every_web_scenario() {
        let mut left_out = Vec::new();
        for screen in &SCREENS {
            let feature = render_screen_feature(screen);
            for scenario in screen.scenarios {
                let rendered = feature.contains(&format!("  Scenario: {}\n", scenario.name));
                let on_web = scenario_platforms(scenario).contains(&Platform::Web);
                assert_eq!(rendered, on_web, "{}", scenario.name);
                if !on_web {
                    left_out.push(scenario.name);
                }
            }
        }
        // The location and notification scenarios: the web has neither (REQ-PRV-007, ADR-0044).
        assert_eq!(left_out.len(), 4, "{left_out:?}");
        assert!(!SCREENS
            .iter()
            .map(render_screen_feature)
            .any(|feature| feature.contains("use-location-button")
                || feature.contains("notify-me-button")
                || feature.contains("the permission ")));
    }
}
