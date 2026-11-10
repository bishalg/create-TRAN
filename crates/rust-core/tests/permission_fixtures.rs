// Verifies: REQ-PRV-001 REQ-PRV-002 REQ-PRV-008
//! The permission catalogue, the next-step table and the personal questions from
//! `fixtures/permissions.json`, shared with TypeScript, UniFFI and native.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::permissions::{permission_step, PermissionStatus, PermissionStep, PERMISSIONS};
use rust_core::personal_questions::PERSONAL_QUESTIONS;
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/permissions.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    permissions: Vec<PermissionCase>,
    steps: Vec<StepCase>,
    personal_questions: Vec<QuestionCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionCase {
    id: String,
    feature: String,
    control: String,
    priming_title: String,
    priming_body: String,
    purpose: String,
    settings_note: String,
    fallback: String,
    android_permissions: Vec<String>,
    ios_usage_descriptions: Vec<String>,
}

#[derive(Deserialize)]
struct StepCase {
    name: String,
    status: String,
    primed: bool,
    step: String,
}

#[derive(Deserialize)]
struct QuestionCase {
    id: String,
    feature: String,
    label: String,
    required: Option<String>,
    answers: Vec<AnswerCase>,
}

#[derive(Deserialize)]
struct AnswerCase {
    id: String,
    kind: String,
    label: String,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/permissions.json")
}

fn status(name: &str) -> PermissionStatus {
    PermissionStatus::ALL
        .into_iter()
        .find(|status| status.as_str() == name)
        .unwrap_or_else(|| panic!("unknown fixture status {name:?}"))
}

#[test]
fn the_catalogue_matches_the_fixture() {
    let expected = fixtures().permissions;
    assert_eq!(expected.len(), PERMISSIONS.len());
    for (case, permission) in expected.iter().zip(PERMISSIONS) {
        assert_eq!(case.id, permission.id.as_str());
        assert_eq!(case.feature, permission.feature);
        assert_eq!(case.control, permission.control);
        assert_eq!(case.priming_title, permission.priming_title);
        assert_eq!(case.priming_body, permission.priming_body);
        assert_eq!(case.purpose, permission.purpose);
        assert_eq!(case.settings_note, permission.settings_note);
        assert_eq!(case.fallback, permission.fallback.as_str());
        assert_eq!(case.android_permissions, permission.android_permissions);
        assert_eq!(
            case.ios_usage_descriptions,
            permission.ios_usage_descriptions
        );
    }
}

#[test]
fn every_status_and_primed_pair_is_pinned() {
    let cases = fixtures().steps;
    assert_eq!(cases.len(), PermissionStatus::ALL.len() * 2);
    for case in &cases {
        let step = permission_step(status(&case.status), case.primed);
        assert_eq!(step.as_str(), case.step, "{}", case.name);
    }
    for status in PermissionStatus::ALL {
        for primed in [false, true] {
            assert!(
                cases
                    .iter()
                    .any(|c| c.status == status.as_str() && c.primed == primed),
                "{status:?} {primed} is not in the fixture"
            );
        }
    }
    let steps: Vec<&str> = PermissionStep::ALL.map(PermissionStep::as_str).to_vec();
    assert!(cases.iter().all(|c| steps.contains(&c.step.as_str())));
}

#[test]
fn the_personal_questions_match_the_fixture() {
    let expected = fixtures().personal_questions;
    assert_eq!(expected.len(), PERSONAL_QUESTIONS.len());
    for (case, question) in expected.iter().zip(PERSONAL_QUESTIONS) {
        assert_eq!(case.id, question.id);
        assert_eq!(case.feature, question.feature);
        assert_eq!(case.label, question.label);
        assert_eq!(case.required.as_deref(), question.required);
        let answers: Vec<(&str, &str, &str)> = question
            .answers
            .iter()
            .map(|a| (a.id, a.kind.as_str(), a.label))
            .collect();
        let pinned: Vec<(&str, &str, &str)> = case
            .answers
            .iter()
            .map(|a| (a.id.as_str(), a.kind.as_str(), a.label.as_str()))
            .collect();
        assert_eq!(answers, pinned, "{}", case.id);
    }
}
