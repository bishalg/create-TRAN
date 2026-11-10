// Verifies: REQ-PRV-001 REQ-PRV-002 REQ-PRV-008
//! The permission catalogue, the next-step table and the personal questions through the UniFFI
//! export surface (same fixture as rust-core).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use tran_uniffi::{
    permission_catalogue, permission_entry, permission_step, personal_questions, TranAnswerKind,
    TranPermissionFallback, TranPermissionId, TranPermissionStatus, TranPermissionStep,
};

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
    serde_json::from_str(include_str!("../../../fixtures/permissions.json")).unwrap()
}

fn id_name(id: TranPermissionId) -> &'static str {
    match id {
        TranPermissionId::LocationApproximate => "location_approximate",
        TranPermissionId::Notifications => "notifications",
    }
}

fn fallback_name(fallback: TranPermissionFallback) -> &'static str {
    match fallback {
        TranPermissionFallback::KeepManualEntry => "keep_manual_entry",
        TranPermissionFallback::NoReminder => "no_reminder",
    }
}

fn status(name: &str) -> TranPermissionStatus {
    match name {
        "not_determined" => TranPermissionStatus::NotDetermined,
        "granted" => TranPermissionStatus::Granted,
        "granted_approximate" => TranPermissionStatus::GrantedApproximate,
        "denied" => TranPermissionStatus::Denied,
        "denied_permanently" => TranPermissionStatus::DeniedPermanently,
        "restricted" => TranPermissionStatus::Restricted,
        other => panic!("unknown fixture status {other:?}"),
    }
}

fn step_name(step: TranPermissionStep) -> &'static str {
    match step {
        TranPermissionStep::ShowPriming => "show_priming",
        TranPermissionStep::RequestSystem => "request_system",
        TranPermissionStep::UseFeature => "use_feature",
        TranPermissionStep::OfferSettings => "offer_settings",
    }
}

fn kind_name(kind: TranAnswerKind) -> &'static str {
    match kind {
        TranAnswerKind::Choice => "choice",
        TranAnswerKind::SelfDescribed => "self_described",
        TranAnswerKind::PreferNotToSay => "prefer_not_to_say",
    }
}

#[test]
fn the_catalogue_matches_the_fixture() {
    let expected = fixtures().permissions;
    let catalogue = permission_catalogue();
    assert_eq!(expected.len(), catalogue.len());
    for (case, permission) in expected.iter().zip(catalogue) {
        assert_eq!(case.id, id_name(permission.id));
        assert_eq!(case.feature, permission.feature);
        assert_eq!(case.control, permission.control);
        assert_eq!(case.priming_title, permission.priming_title_key);
        assert_eq!(case.priming_body, permission.priming_body_key);
        assert_eq!(case.purpose, permission.purpose_key);
        assert_eq!(case.settings_note, permission.settings_note_key);
        assert_eq!(case.fallback, fallback_name(permission.fallback));
        assert_eq!(case.android_permissions, permission.android_permissions);
        assert_eq!(
            case.ios_usage_descriptions,
            permission.ios_usage_descriptions
        );
        assert_eq!(permission_entry(permission.id), permission);
    }
}

#[test]
fn every_status_and_primed_pair_matches_the_fixture() {
    for case in fixtures().steps {
        let step = permission_step(status(&case.status), case.primed);
        assert_eq!(step_name(step), case.step, "{}", case.name);
    }
}

#[test]
fn the_personal_questions_match_the_fixture() {
    let expected = fixtures().personal_questions;
    let questions = personal_questions();
    assert_eq!(expected.len(), questions.len());
    for (case, question) in expected.iter().zip(questions) {
        assert_eq!(case.id, question.id);
        assert_eq!(case.feature, question.feature);
        assert_eq!(case.label, question.label_key);
        assert_eq!(case.required, question.required_by);
        let answers: Vec<(String, &str, String)> = question
            .answers
            .into_iter()
            .map(|a| (a.id, kind_name(a.kind), a.label_key))
            .collect();
        let pinned: Vec<(String, &str, String)> = case
            .answers
            .iter()
            .map(|a| (a.id.clone(), a.kind.as_str(), a.label.clone()))
            .collect();
        assert_eq!(answers, pinned, "{}", case.id);
    }
}
