// Verifies: REQ-RULE-001
//! Golden fixtures exercised through the UniFFI export surface (same data as rust-core parity).

use chrono::NaiveDate;
use rust_core::VoteEligibilityRequest;
use serde::Deserialize;
use tran_uniffi::{
    age_from_birthdate_offline, can_vote_by_age_offline, evaluate_vote_eligibility_offline,
    voting_age_for_country_offline, TranValidationError,
};

const FIXTURE: &str = include_str!("../../../fixtures/vote-eligibility.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    voting_ages: Vec<VotingAgeCase>,
    can_vote: Vec<CanVoteCase>,
    age_from_birthdate: Vec<AgeCase>,
    evaluations: Vec<EvaluationCase>,
    rejected_evaluations: Vec<RejectedCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VotingAgeCase {
    country: String,
    minimum_age: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanVoteCase {
    age: u16,
    minimum_age: u16,
    expected: bool,
}

#[derive(Deserialize)]
struct AgeCase {
    name: String,
    birthdate: NaiveDate,
    reference: NaiveDate,
    expected: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    eligible: bool,
    age: u16,
    minimum_age: u16,
    country_code: String,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluationCase {
    name: String,
    input: VoteEligibilityRequest,
    country_code: String,
    reference_date: NaiveDate,
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RejectedCase {
    name: String,
    input: VoteEligibilityRequest,
    country_code: String,
    reference_date: NaiveDate,
    error: String,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/vote-eligibility.json must be valid")
}

fn validation_message(err: TranValidationError) -> String {
    err.detail().to_string()
}

#[test]
fn uniffi_voting_ages_match_fixture() {
    for case in fixtures().voting_ages {
        assert_eq!(
            voting_age_for_country_offline(case.country),
            case.minimum_age
        );
    }
}

#[test]
fn uniffi_can_vote_matches_fixture() {
    for case in fixtures().can_vote {
        assert_eq!(
            can_vote_by_age_offline(case.age, case.minimum_age),
            case.expected
        );
    }
}

#[test]
fn uniffi_age_from_birthdate_matches_fixture() {
    for case in fixtures().age_from_birthdate {
        assert_eq!(
            age_from_birthdate_offline(
                case.birthdate.format("%Y-%m-%d").to_string(),
                case.reference.format("%Y-%m-%d").to_string(),
            ),
            case.expected,
            "{}",
            case.name
        );
    }
}

#[test]
fn uniffi_evaluations_match_fixture() {
    for case in fixtures().evaluations {
        let birth = case
            .input
            .birthdate
            .map(|d| d.format("%Y-%m-%d").to_string());
        let res = evaluate_vote_eligibility_offline(
            case.input.age,
            birth,
            case.country_code.clone(),
            case.reference_date.format("%Y-%m-%d").to_string(),
        )
        .unwrap_or_else(|e| panic!("{}: {e}", case.name));

        assert_eq!(res.eligible, case.expected.eligible, "{}", case.name);
        assert_eq!(res.age, case.expected.age, "{}", case.name);
        assert_eq!(res.minimum_age, case.expected.minimum_age, "{}", case.name);
        assert_eq!(
            res.country_code, case.expected.country_code,
            "{}",
            case.name
        );
        assert_eq!(res.reason, case.expected.reason, "{}", case.name);
    }
}

#[test]
fn uniffi_rejected_evaluations_match_fixture() {
    for case in fixtures().rejected_evaluations {
        let birth = case
            .input
            .birthdate
            .map(|d| d.format("%Y-%m-%d").to_string());
        let err = evaluate_vote_eligibility_offline(
            case.input.age,
            birth,
            case.country_code.clone(),
            case.reference_date.format("%Y-%m-%d").to_string(),
        )
        .expect_err(&case.name);
        assert_eq!(validation_message(err), case.error, "{}", case.name);
    }
}
