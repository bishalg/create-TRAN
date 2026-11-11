//! The contract checks itself before any platform reads it (REQ-SCR-001, REQ-SCR-003, REQ-SCR-004,
//! REQ-SCR-007).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test code")]

use super::*;
use crate::feedback::{LOADING_POLICY, SERVER_DEADLINE_MS};
use crate::navigation::AppDestination;
use crate::permissions::{PermissionId, PermissionStatus};
use crate::test_support::{locales, spec_requirement_ids};
use crate::{can_vote_by_age, tokens_json_snapshot, voting_age_for_country};
use std::collections::{BTreeMap, BTreeSet};

fn is_kebab_case(id: &str) -> bool {
    !id.is_empty()
        && id.split('-').all(|part| {
            part.starts_with(|c: char| c.is_ascii_lowercase())
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

fn camel_case(snake: &str) -> String {
    snake
        .split('_')
        .enumerate()
        .map(|(index, part)| {
            if index == 0 {
                part.to_string()
            } else {
                part[..1].to_uppercase() + &part[1..]
            }
        })
        .collect()
}

fn all_scenarios() -> impl Iterator<Item = &'static Scenario> {
    SCREENS.iter().flat_map(|screen| screen.scenarios)
}

/// `{name}` placeholders of a locale string, in order of first appearance: the order of the
/// positional `%1$@` / `%1$s` arguments the native string resources are generated with.
fn placeholders(value: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for name in value
        .split('{')
        .skip(1)
        .filter_map(|rest| rest.split_once('}').map(|(name, _)| name.to_string()))
    {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

// Verifies: REQ-SCR-001
#[test]
fn ids_are_kebab_case_and_one_id_is_one_element() {
    let mut by_id: BTreeMap<&str, Element> = BTreeMap::new();
    let mut screen_ids = BTreeSet::new();
    for screen in &SCREENS {
        assert!(screen_ids.insert(screen.id), "screen `{}` twice", screen.id);
        assert!(
            screen
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b == b'_'),
            "screen id `{}` must be snake_case",
            screen.id
        );
        let mut on_screen = BTreeSet::new();
        for element in screen.elements {
            assert!(
                is_kebab_case(element.id),
                "`{}` is not kebab-case",
                element.id
            );
            assert!(
                on_screen.insert(element.id),
                "`{}` twice on `{}`",
                element.id,
                screen.id
            );
            let first = *by_id.entry(element.id).or_insert(*element);
            assert_eq!(first, *element, "`{}` names two elements", element.id);
        }
    }
    assert_eq!(unique_elements().len(), by_id.len());
    assert!(!is_kebab_case("Check-button") && !is_kebab_case("check_button"));
    assert!(!is_kebab_case("") && !is_kebab_case("check--button"));
}

// Verifies: REQ-SCR-005 REQ-SCR-006 — a scenario's name is how every interpreter finds its data
// (the Gherkin title on the web, the `screens.json` entry natively), so it names one scenario.
#[test]
fn scenario_names_are_unique_and_quotable() {
    let mut names = BTreeSet::new();
    for scenario in all_scenarios() {
        assert!(names.insert(scenario.name), "`{}` twice", scenario.name);
        assert!(
            !scenario.name.contains('"') && !scenario.name.contains('\n'),
            "`{}` cannot be a Gherkin title",
            scenario.name
        );
    }
}

// Verifies: REQ-SCR-001
#[test]
fn every_destination_has_exactly_one_screen() {
    let destinations: Vec<AppDestination> = SCREENS.iter().map(|s| s.destination).collect();
    assert_eq!(
        destinations,
        [
            AppDestination::Splash,
            AppDestination::AuthWelcome,
            AppDestination::VoterDashboard,
            AppDestination::AuditorDashboard,
        ]
    );
}

// Verifies: REQ-SCR-001
#[test]
fn every_label_and_intent_key_exists_in_every_locale() {
    let locales = locales();
    assert!(locales.len() >= 3, "{:?}", locales.keys());
    for screen in &SCREENS {
        assert_eq!(
            screen.intent,
            format!("screen.{}.intent", camel_case(screen.id))
        );
        let keys = std::iter::once(screen.intent).chain(screen.elements.iter().map(|e| e.label));
        for key in keys {
            for (locale, dictionary) in &locales {
                assert!(
                    dictionary.contains_key(key),
                    "`{key}` missing in `{locale}`"
                );
            }
        }
    }
}

// Verifies: REQ-SCR-004 REQ-SCR-006 — a `text_is` or `announced` key resolves, with exactly its
// placeholders, listed in the template's order: the native interpreters pass `args` positionally
// to the generated `%n$@` / `%n$s` resources.
#[test]
fn every_expected_message_resolves_with_its_arguments() {
    let locales = locales();
    let base = &locales["en"];
    let mut checked = 0;
    for then in all_scenarios().flat_map(|s| s.then) {
        let Some((key, args)) = then.message() else {
            continue;
        };
        let value = &base[key];
        let names: Vec<String> = args.iter().map(|a| a.name.to_string()).collect();
        assert_eq!(
            names,
            placeholders(value),
            "`{key}` arguments, in the template's order"
        );
        for dictionary in locales.values() {
            assert!(dictionary.contains_key(key), "`{key}`");
        }
        checked += 1;
    }
    assert!(checked > 0);
}

// Verifies: REQ-SCR-004
#[test]
fn every_citation_names_a_spec_requirement() {
    let known = spec_requirement_ids();
    for scenario in all_scenarios() {
        assert!(
            !scenario.verifies.is_empty(),
            "`{}` cites nothing",
            scenario.name
        );
        for id in scenario.verifies {
            assert!(
                known.contains(*id),
                "`{}` cites unknown `{id}`",
                scenario.name
            );
        }
    }
}

// Verifies: REQ-SCR-004
#[test]
fn every_scenario_is_bounded_by_the_feedback_policy() {
    assert_eq!(
        SCENARIO_BOUND_MS,
        LOADING_POLICY.indicator_delay_ms + SERVER_DEADLINE_MS
    );
    let mut names = BTreeSet::new();
    for scenario in all_scenarios() {
        assert!(names.insert(scenario.name), "`{}` twice", scenario.name);
        assert!(
            scenario.within_ms > 0 && scenario.within_ms <= SCENARIO_BOUND_MS,
            "`{}` takes {} ms",
            scenario.name,
            scenario.within_ms
        );
        assert!(
            !scenario.then.is_empty(),
            "`{}` expects nothing",
            scenario.name
        );
    }
}

// Verifies: REQ-SCR-004 — steps address declared elements only.
#[test]
fn every_step_names_a_declared_element() {
    let ids: BTreeSet<&str> = unique_elements().iter().map(|e| e.id).collect();
    for scenario in all_scenarios() {
        let used = scenario
            .when
            .iter()
            .filter_map(|step| step.element())
            .chain(scenario.then.iter().map(|then| then.element()));
        for id in used {
            assert!(
                ids.contains(id),
                "`{}` names undeclared `{id}`",
                scenario.name
            );
        }
    }
}

/// Snapshot of the closed verb set. Changing it changes the interpreters on every platform: update
/// ADR-0038 in the same change (REQ-SCR-004).
// Verifies: REQ-SCR-004
#[test]
fn the_verb_set_is_closed() {
    let given = [
        Given::Session(SessionKind::None),
        Given::ApiReachable,
        Given::ApiUnreachable,
        Given::Locale("ne"),
        Given::Theme("sepia"),
        Given::LargestTextScale,
        Given::ReducedMotion,
        Given::Permission {
            id: PermissionId::LocationApproximate,
            status: PermissionStatus::Denied,
        },
        Given::UpgradeRequired,
    ];
    let when = [
        When::Tap("a"),
        When::Type { id: "a", text: "1" },
        When::Select {
            id: "a",
            option: "b",
        },
        When::PressKey {
            id: "a",
            key: "Enter",
        },
        When::GoOffline,
        When::GoOnline,
    ];
    let then = [
        Then::Exists("a"),
        Then::Missing("a"),
        Then::TextIs {
            id: "a",
            key: "k",
            args: &[],
        },
        Then::HasFocus("a"),
        Then::Announced {
            id: "a",
            key: "k",
            args: &[],
        },
        Then::Count { id: "a", n: 1 },
    ];
    assert_eq!(
        given.map(Given::verb),
        [
            "session",
            "api_reachable",
            "api_unreachable",
            "locale",
            "theme",
            "largest_text_scale",
            "reduced_motion",
            "permission",
            "upgrade_required"
        ]
    );
    assert_eq!(
        when.map(When::verb),
        [
            "tap",
            "type",
            "select",
            "press_key",
            "go_offline",
            "go_online"
        ]
    );
    assert_eq!(
        then.map(Then::verb),
        [
            "exists",
            "missing",
            "text_is",
            "has_focus",
            "announced",
            "count"
        ]
    );
    assert_eq!(given.map(Given::verb), Given::VERBS);
    assert_eq!(when.map(When::verb), When::VERBS);
    assert_eq!(then.map(Then::verb), Then::VERBS);
    // The serialized name is the verb, so the generated JSON speaks the same vocabulary.
    for (value, verb) in given.iter().map(|g| (serde_json::to_value(g), g.verb())) {
        assert_eq!(verb_of(&value.unwrap()), verb);
    }
    for (value, verb) in when.iter().map(|w| (serde_json::to_value(w), w.verb())) {
        assert_eq!(verb_of(&value.unwrap()), verb);
    }
    for (value, verb) in then.iter().map(|t| (serde_json::to_value(t), t.verb())) {
        assert_eq!(verb_of(&value.unwrap()), verb);
    }
    assert_eq!(
        when.map(When::element),
        [Some("a"), Some("a"), Some("a"), Some("a"), None, None]
    );
    assert_eq!(then.map(Then::element), ["a"; 6]);
    assert_eq!(
        then.map(|t| t.message().is_some()),
        [false, false, true, false, true, false]
    );
}

fn verb_of(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => map.keys().next().unwrap().clone(),
        other => other.as_str().unwrap().to_string(),
    }
}

// Verifies: REQ-SCR-003 — the generated JSON cannot carry presentation.
#[test]
fn the_contract_never_describes_presentation() {
    const FORBIDDEN: [&str; 14] = [
        "colour", "color", "size", "spacing", "gap", "font", "weight", "order", "layout", "width",
        "height", "padding", "margin", "style",
    ];
    fn keys(value: &serde_json::Value, out: &mut BTreeSet<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    out.insert(key.to_lowercase());
                    keys(child, out);
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|item| keys(item, out)),
            _ => {}
        }
    }
    let json = serde_json::to_value(screens_json_snapshot()).unwrap();
    let mut found = BTreeSet::new();
    keys(&json, &mut found);
    assert!(found.contains("elements") && found.contains("within_ms"));
    let offending: Vec<&String> = found
        .iter()
        .filter(|key| FORBIDDEN.iter().any(|word| key.contains(word)))
        .collect();
    assert!(offending.is_empty(), "presentation keys: {offending:?}");

    let kinds: Vec<serde_json::Value> = ElementKind::ALL
        .iter()
        .map(|k| serde_json::to_value(k).unwrap())
        .collect();
    let names: Vec<&str> = ElementKind::ALL.iter().map(|k| k.as_str()).collect();
    assert_eq!(kinds, names);
    assert_eq!(
        names,
        [
            "field",
            "button",
            "text",
            "live_region",
            "banner",
            "toast",
            "dialog",
            "segmented",
            "progress"
        ]
    );
    for touch in [TouchClass::Control, TouchClass::Primary, TouchClass::None] {
        assert_eq!(serde_json::to_value(touch).unwrap(), touch.as_str());
    }
}

// Verifies: REQ-SCR-004 — the verdicts the scenarios expect are the ones the Rust rules give.
#[test]
fn eligibility_scenarios_agree_with_the_rules() {
    let mut checked = 0;
    for scenario in all_scenarios() {
        let typed = |field: &str| {
            scenario.when.iter().find_map(|step| match step {
                When::Type { id, text } if *id == field => Some(*text),
                _ => None,
            })
        };
        let (Some(age), Some(country)) = (typed("age-field"), typed("country-field")) else {
            continue;
        };
        let Ok(age) = age.parse::<u16>() else {
            continue;
        };
        let minimum = voting_age_for_country(country);
        let key = if can_vote_by_age(age, minimum) {
            "eligibility.result.reasonMeets"
        } else {
            "eligibility.result.reasonBelow"
        };
        let expected = [
            ("age", age.to_string()),
            ("minimumAge", minimum.to_string()),
            ("country", country.to_string()),
        ];
        for then in scenario
            .then
            .iter()
            .filter(|t| t.element() == "offline-result")
        {
            if let Some((message_key, args)) = then.message() {
                assert_eq!(message_key, key, "{}", scenario.name);
                let got: Vec<(&str, String)> =
                    args.iter().map(|a| (a.name, a.value.to_string())).collect();
                assert_eq!(got, expected, "{}", scenario.name);
                checked += 1;
            }
        }
    }
    assert!(checked >= 5, "{checked}");
}

// Verifies: REQ-NAT-007 — every registry theme has a scenario that selects it.
#[test]
fn every_registry_theme_is_selected_by_a_scenario() {
    let selected: BTreeSet<&str> = all_scenarios()
        .flat_map(|s| s.when)
        .filter_map(|step| match step {
            When::Select {
                id: "theme-picker",
                option,
            } => Some(*option),
            _ => None,
        })
        .collect();
    let registry: BTreeSet<String> = tokens_json_snapshot()
        .themes
        .into_iter()
        .map(|theme| theme.mode)
        .collect();
    assert_eq!(
        selected
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>(),
        registry
    );
}

// Verifies: REQ-SCR-007 — the minimums are one table, one row per platform.
#[test]
fn platform_minimums_are_one_table() {
    let platforms = [Platform::Web, Platform::Ios, Platform::Android];
    for platform in platforms {
        assert_eq!(platform_minimum(platform).platform, platform);
        assert_eq!(serde_json::to_value(platform).unwrap(), platform.as_str());
    }
    let web = platform_minimum(Platform::Web);
    assert_eq!(
        (
            web.for_touch(TouchClass::Control),
            web.for_touch(TouchClass::Primary)
        ),
        (Some(24), Some(44))
    );
    assert_eq!(web.for_touch(TouchClass::None), None);
    assert_eq!(platform_minimum(Platform::Ios).control, 44);
    assert_eq!(platform_minimum(Platform::Android).control, 48);
    assert_eq!(
        platform_minimum(Platform::Android).largest_text_scale,
        TextScale::Percent(200)
    );
    for row in PLATFORM_MINIMUMS {
        assert!(row.primary_action >= row.control, "{row:?}");
    }
    // Each screen has at most one primary action.
    for screen in &SCREENS {
        let primaries = screen
            .elements
            .iter()
            .filter(|e| e.touch == TouchClass::Primary)
            .count();
        assert!(
            primaries <= 1,
            "`{}` has {primaries} primary actions",
            screen.id
        );
    }
}

// Verifies: REQ-SCR-004 — the constructors used by the tables also work at run time.
#[test]
fn constructors_default_the_bound_and_keep_their_fields() {
    let scenario = Scenario::new("n", &["REQ-SCR-004"], &[], &[], &[Then::Exists("a")]);
    assert_eq!(scenario.within_ms, SCENARIO_BOUND_MS);
    assert_eq!(scenario.verifies, ["REQ-SCR-004"]);
    let element = super::catalogue::element(
        "a",
        ElementKind::Text,
        "common.brand",
        TouchClass::None,
        Presence::Always,
    );
    assert_eq!((element.id, element.label), ("a", "common.brand"));
}

// Verifies: REQ-SCR-008 — an element offered on fewer platforms names at least one, once each,
// and every platform still offers every screen something.
#[test]
fn platform_scoped_elements_name_their_platforms() {
    for element in unique_elements() {
        let mut seen = Vec::new();
        for platform in element.platforms {
            assert!(
                !seen.contains(platform),
                "`{}` lists {platform:?} twice",
                element.id
            );
            seen.push(*platform);
        }
        assert!(!seen.is_empty(), "`{}` is offered nowhere", element.id);
    }
    for screen in &SCREENS {
        for platform in Platform::ALL {
            assert!(
                screen.elements.iter().any(|e| e.is_on(platform)),
                "`{}` offers {platform:?} nothing",
                screen.id
            );
        }
    }
    let scoped = super::catalogue::element(
        "a",
        ElementKind::Button,
        "common.brand",
        TouchClass::Control,
        Presence::Always,
    )
    .only(&[Platform::Web]);
    assert!(scoped.is_on(Platform::Web) && !scoped.is_on(Platform::Ios));
}

// Verifies: REQ-SCR-008 — an unreached state is one some element depends on, and no scenario
// expects an element of it: once one does, the entry must go.
#[test]
fn unreached_states_are_real_and_still_unreached() {
    let states: BTreeSet<&str> = unique_elements()
        .iter()
        .filter_map(|element| match element.presence {
            Presence::When(state) => Some(state),
            Presence::Always => None,
        })
        .collect();
    for unreached in &UNREACHED_STATES {
        assert!(
            states.contains(unreached.state),
            "`{}` is no element's state",
            unreached.state
        );
        assert!(!unreached.reason.is_empty());
        let in_state: Vec<&str> = unique_elements()
            .iter()
            .filter(|element| element.presence == Presence::When(unreached.state))
            .map(|element| element.id)
            .collect();
        for scenario in all_scenarios() {
            for then in scenario.then {
                let expects = match then {
                    Then::Missing(_) => false,
                    Then::Count { n, .. } => *n > 0,
                    _ => true,
                };
                assert!(
                    !(expects && in_state.contains(&then.element())),
                    "\"{}\" reaches `{}`: remove it from UNREACHED_STATES",
                    scenario.name,
                    unreached.state
                );
            }
        }
    }
}

// Verifies: REQ-SCR-008 REQ-PRV-007 — a scenario runs where every element it names is offered and
// every given can be staged, so the web never renders the native-only location scenarios.
#[test]
fn scenarios_run_only_where_their_elements_and_givens_are() {
    let mut native_only = Vec::new();
    for scenario in all_scenarios() {
        let platforms = scenario_platforms(scenario);
        assert!(!platforms.is_empty(), "\"{}\" runs nowhere", scenario.name);
        assert!(
            platforms.contains(&Platform::Ios) && platforms.contains(&Platform::Android),
            "\"{}\" must run on both native platforms",
            scenario.name
        );
        if !platforms.contains(&Platform::Web) {
            native_only.push(scenario.name);
        }
    }
    assert_eq!(
        native_only,
        [
            "The reminder stays hidden until it is switched on",
            "Using my location explains first and Not now changes nothing",
            "Using my location without permission keeps the chosen country",
            "Asking to be notified explains first",
            "Asking to be notified without permission keeps the verdict"
        ]
    );
    let staged = Scenario::new(
        "n",
        &["REQ-PRV-004"],
        &[Given::Permission {
            id: PermissionId::LocationApproximate,
            status: PermissionStatus::Restricted,
        }],
        &[],
        &[Then::Exists("check-button")],
    );
    assert_eq!(
        scenario_platforms(&staged),
        [Platform::Ios, Platform::Android]
    );
    assert_eq!(Given::ApiReachable.platforms(), Platform::ALL);
}

// Verifies: REQ-PRV-003 REQ-PRV-007 — the location control and its states exist only natively,
// and its priming and settings states are reached by a scenario.
#[test]
fn the_location_control_is_native_and_its_states_are_reached() {
    let eligibility = SCREENS
        .iter()
        .find(|screen| screen.id == "eligibility")
        .unwrap();
    for id in [
        "use-location-button",
        "location-priming-continue",
        "location-priming-dismiss",
        "location-settings-note",
        "location-open-settings",
    ] {
        let element = eligibility.elements.iter().find(|e| e.id == id).unwrap();
        assert_eq!(
            element.platforms,
            [Platform::Ios, Platform::Android],
            "{id}"
        );
    }
    let tapped: BTreeSet<&str> = all_scenarios()
        .flat_map(|s| s.when)
        .filter_map(|step| step.element())
        .collect();
    let expected: BTreeSet<&str> = all_scenarios()
        .flat_map(|s| s.then)
        .filter(|then| matches!(then, Then::Exists(_)))
        .map(|then| then.element())
        .collect();
    assert!(tapped.contains("location-priming-dismiss"));
    assert!(expected.contains("location-settings-note"));
}

// Verifies: REQ-PSH-008 REQ-PSH-012 — the notification control exists only natively, only beside a
// "not yet eligible" verdict (never because push is unavailable), and its priming and settings
// states are reached by a scenario that stages the `notifications` permission.
#[test]
fn the_notify_control_is_native_gated_by_the_verdict_and_its_states_are_reached() {
    use super::catalogue::state;
    let eligibility = SCREENS
        .iter()
        .find(|screen| screen.id == "eligibility")
        .unwrap();
    let presence = |id: &str| {
        let element = eligibility.elements.iter().find(|e| e.id == id).unwrap();
        assert_eq!(
            element.platforms,
            [Platform::Ios, Platform::Android],
            "{id}"
        );
        element.presence
    };
    assert_eq!(
        presence("notify-me-button"),
        Presence::When(state::NOT_YET_ELIGIBLE)
    );
    for id in ["notify-priming-continue", "notify-priming-dismiss"] {
        assert_eq!(presence(id), Presence::When(state::NOTIFY_PRIMING));
    }
    for id in ["notify-settings-note", "notify-open-settings"] {
        assert_eq!(presence(id), Presence::When(state::NOTIFY_SETTINGS_OFFERED));
    }
    assert!(unique_elements()
        .iter()
        .all(|e| e.presence != Presence::When(state::PUSH_UNAVAILABLE)));

    let staging: Vec<&Scenario> = all_scenarios()
        .filter(|s| s.when.contains(&When::Tap("notify-me-button")))
        .collect();
    assert_eq!(staging.len(), 2);
    for scenario in &staging {
        assert!(
            scenario.given.iter().any(|given| matches!(
                given,
                Given::Permission {
                    id: PermissionId::Notifications,
                    ..
                }
            )),
            "\"{}\" must stage push through the notifications permission",
            scenario.name
        );
    }
    let expected: BTreeSet<&str> = staging
        .iter()
        .flat_map(|s| s.then)
        .filter(|then| matches!(then, Then::Exists(_)))
        .map(|then| then.element())
        .collect();
    assert!(expected.contains("notify-priming-continue"));
    assert!(expected.contains("notify-settings-note"));
}
