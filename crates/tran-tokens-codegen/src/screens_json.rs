//! `screens.json` for the native UI-test bundles (ADR-0038, REQ-SCR-005): the same bytes in
//! `apps/ios/Tests/TranVotingDemoUITests/Resources/` and `apps/android/app/src/androidTest/assets/`.
//!
//! The shape is flat so Swift `Codable` and Kotlin `org.json` decode it without enums with
//! payloads: every step is one object with a `verb` and only the fields that verb uses.
//!
//! ```json
//! {
//!   "scenario_bound_ms": 4300,
//!   "screens": [{
//!     "id": "eligibility", "destination": "voter_dashboard", "intent": "screen.eligibility.intent",
//!     "elements": [{ "id": "offline-notice", "kind": "banner", "label": "…", "touch": "none",
//!                    "presence": "when", "state": "api_unreachable" }],
//!     "scenarios": [{
//!       "name": "…", "verifies": ["REQ-NAT-011"], "within_ms": 4300,
//!       "given": [{ "verb": "session", "value": "citizen_voter" }, { "verb": "api_unreachable" }],
//!       "when":  [{ "verb": "type", "id": "age-field", "text": "20" }, { "verb": "tap", "id": "check-button" }],
//!       "then":  [{ "verb": "text_is", "id": "offline-result", "key": "…",
//!                   "args": [{ "name": "age", "value": "20" }] },
//!                 { "verb": "count", "id": "sign-out-button", "n": 1 }]
//!     }]
//!   }]
//! }
//! ```
//!
//! Step fields: `value` (session, locale and theme givens), `id` (every step on an element),
//! `text` (`type`), `option` (`select`), `key` (`press_key`, and the locale key of `text_is` and
//! `announced`), `args` (`text_is`, `announced`, possibly empty), `n` (`count`). `presence` is
//! `always` or `when` with `state`. Touch minimums are not repeated here: the native tests read
//! them from the generated `ScreenContract.Minimums`.

use crate::screens_gherkin::session_name;
use rust_core::screens::{
    Arg, Element, Given, Presence, Scenario, Screen, ScreensJsonSnapshot, Then, When,
};
use serde::Serialize;

#[derive(Serialize)]
struct Catalogue {
    scenario_bound_ms: u64,
    screens: Vec<ScreenJson>,
}

#[derive(Serialize)]
struct ScreenJson {
    id: &'static str,
    destination: &'static str,
    intent: &'static str,
    elements: Vec<ElementJson>,
    scenarios: Vec<ScenarioJson>,
}

#[derive(Serialize)]
struct ElementJson {
    id: &'static str,
    kind: &'static str,
    label: &'static str,
    touch: &'static str,
    presence: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<&'static str>,
}

#[derive(Serialize)]
struct ScenarioJson {
    name: &'static str,
    verifies: &'static [&'static str],
    within_ms: u64,
    given: Vec<Step>,
    when: Vec<Step>,
    then: Vec<Step>,
}

/// One step: the verb plus the fields it uses (see the module comment).
#[derive(Serialize, Default, Debug, PartialEq, Eq)]
pub struct Step {
    pub verb: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<&'static [Arg]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
}

pub fn given_step(given: Given) -> Step {
    let value = match given {
        Given::Session(kind) => Some(session_name(kind)),
        Given::Locale(value) | Given::Theme(value) => Some(value),
        Given::ApiReachable
        | Given::ApiUnreachable
        | Given::LargestTextScale
        | Given::ReducedMotion => None,
    };
    Step {
        verb: given.verb(),
        value,
        ..Step::default()
    }
}

pub fn when_step(when: When) -> Step {
    let base = Step {
        verb: when.verb(),
        id: when.element(),
        ..Step::default()
    };
    match when {
        When::Type { text, .. } => Step {
            text: Some(text),
            ..base
        },
        When::Select { option, .. } => Step {
            option: Some(option),
            ..base
        },
        When::PressKey { key, .. } => Step {
            key: Some(key),
            ..base
        },
        When::Tap(_) | When::GoOffline | When::GoOnline => base,
    }
}

pub fn then_step(then: Then) -> Step {
    let base = Step {
        verb: then.verb(),
        id: Some(then.element()),
        ..Step::default()
    };
    match then {
        Then::TextIs { key, args, .. } | Then::Announced { key, args, .. } => Step {
            key: Some(key),
            args: Some(args),
            ..base
        },
        Then::Count { n, .. } => Step { n: Some(n), ..base },
        Then::Exists(_) | Then::Missing(_) | Then::HasFocus(_) => base,
    }
}

fn element_json(element: &Element) -> ElementJson {
    let (presence, state) = match element.presence {
        Presence::Always => ("always", None),
        Presence::When(state) => ("when", Some(state)),
    };
    ElementJson {
        id: element.id,
        kind: element.kind.as_str(),
        label: element.label,
        touch: element.touch.as_str(),
        presence,
        state,
    }
}

fn scenario_json(scenario: &Scenario) -> ScenarioJson {
    ScenarioJson {
        name: scenario.name,
        verifies: scenario.verifies,
        within_ms: scenario.within_ms,
        given: scenario.given.iter().map(|g| given_step(*g)).collect(),
        when: scenario.when.iter().map(|w| when_step(*w)).collect(),
        then: scenario.then.iter().map(|t| then_step(*t)).collect(),
    }
}

fn screen_json(screen: &Screen) -> ScreenJson {
    ScreenJson {
        id: screen.id,
        destination: screen.destination.as_str(),
        intent: screen.intent,
        elements: screen.elements.iter().map(element_json).collect(),
        scenarios: screen.scenarios.iter().map(scenario_json).collect(),
    }
}

pub fn render_screens_json(snapshot: &ScreensJsonSnapshot) -> String {
    let catalogue = Catalogue {
        scenario_bound_ms: snapshot.scenario_bound_ms,
        screens: snapshot.screens.iter().map(screen_json).collect(),
    };
    serde_json::to_string_pretty(&catalogue).expect("the contract is plain data") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::screens::SessionKind;
    use rust_core::screens_json_snapshot;
    use serde_json::{json, Value};

    fn value(step: Step) -> Value {
        serde_json::to_value(step).unwrap()
    }

    // Verifies: REQ-SCR-005 — every verb's step carries only its own fields.
    #[test]
    fn steps_are_flat_objects() {
        let given: Vec<Value> = [
            Given::Session(SessionKind::ElectionAuditor),
            Given::ApiReachable,
            Given::ApiUnreachable,
            Given::Locale("ne"),
            Given::Theme("dark"),
            Given::LargestTextScale,
            Given::ReducedMotion,
        ]
        .map(|g| value(given_step(g)))
        .to_vec();
        assert_eq!(
            given,
            [
                json!({"verb": "session", "value": "election_auditor"}),
                json!({"verb": "api_reachable"}),
                json!({"verb": "api_unreachable"}),
                json!({"verb": "locale", "value": "ne"}),
                json!({"verb": "theme", "value": "dark"}),
                json!({"verb": "largest_text_scale"}),
                json!({"verb": "reduced_motion"}),
            ]
        );
        let when: Vec<Value> = [
            When::Tap("b"),
            When::Type {
                id: "f",
                text: "20",
            },
            When::Select {
                id: "s",
                option: "dark",
            },
            When::PressKey {
                id: "f",
                key: "Enter",
            },
            When::GoOffline,
            When::GoOnline,
        ]
        .map(|w| value(when_step(w)))
        .to_vec();
        assert_eq!(
            when,
            [
                json!({"verb": "tap", "id": "b"}),
                json!({"verb": "type", "id": "f", "text": "20"}),
                json!({"verb": "select", "id": "s", "option": "dark"}),
                json!({"verb": "press_key", "id": "f", "key": "Enter"}),
                json!({"verb": "go_offline"}),
                json!({"verb": "go_online"}),
            ]
        );
        let then: Vec<Value> = [
            Then::Exists("a"),
            Then::Missing("a"),
            Then::TextIs {
                id: "a",
                key: "k",
                args: &[Arg {
                    name: "age",
                    value: "20",
                }],
            },
            Then::HasFocus("a"),
            Then::Announced {
                id: "a",
                key: "k",
                args: &[],
            },
            Then::Count { id: "a", n: 2 },
        ]
        .map(|t| value(then_step(t)))
        .to_vec();
        assert_eq!(
            then,
            [
                json!({"verb": "exists", "id": "a"}),
                json!({"verb": "missing", "id": "a"}),
                json!({"verb": "text_is", "id": "a", "key": "k", "args": [{"name": "age", "value": "20"}]}),
                json!({"verb": "has_focus", "id": "a"}),
                json!({"verb": "announced", "id": "a", "key": "k", "args": []}),
                json!({"verb": "count", "id": "a", "n": 2}),
            ]
        );
    }

    // Verifies: REQ-SCR-005
    #[test]
    fn the_catalogue_carries_every_screen_element_and_scenario() {
        let snapshot = screens_json_snapshot();
        let rendered = render_screens_json(&snapshot);
        assert!(rendered.ends_with("}\n"));
        let parsed: Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(parsed["scenario_bound_ms"], snapshot.scenario_bound_ms);
        let screens = parsed["screens"].as_array().unwrap();
        assert_eq!(screens.len(), snapshot.screens.len());
        for (json, screen) in screens.iter().zip(snapshot.screens) {
            assert_eq!(json["destination"], screen.destination.as_str());
            assert_eq!(
                json["elements"].as_array().unwrap().len(),
                screen.elements.len()
            );
            assert_eq!(
                json["scenarios"].as_array().unwrap().len(),
                screen.scenarios.len()
            );
        }
        let notice = screens[2]["elements"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "offline-notice")
            .unwrap();
        assert_eq!(
            (&notice["presence"], &notice["state"]),
            (&json!("when"), &json!("api_unreachable"))
        );
        assert_eq!(screens[2]["elements"][0]["presence"], "always");
        assert!(screens[2]["elements"][0].get("state").is_none());
    }
}
