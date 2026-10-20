// Verifies: REQ-RULE-001, REQ-FFI-002, REQ-ROB-001
//! Golden fixtures exercised through the UniFFI export surface (same data as rust-core parity).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use chrono::NaiveDate;
use rust_core::VoteEligibilityRequest;
use serde::Deserialize;
use tran_uniffi::{
    age_from_birthdate_offline, can_vote_by_age_offline, evaluate_vote_eligibility_offline,
    voting_age_for_country_offline, TranEligibilityReason, TranValidationError,
};

const FIXTURE: &str = include_str!("../../../fixtures/vote-eligibility.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    voting_ages: Vec<VotingAgeCase>,
    can_vote: Vec<CanVoteCase>,
    age_from_birthdate: Vec<AgeCase>,
    invalid_birthdates: Vec<String>,
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
    reason_code: String,
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
    code: String,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/vote-eligibility.json must be valid")
}

fn reason_code(reason: TranEligibilityReason) -> &'static str {
    match reason {
        TranEligibilityReason::MeetsMinimumAge => "meets_minimum_age",
        TranEligibilityReason::BelowMinimumAge => "below_minimum_age",
    }
}

fn validation_code(err: &TranValidationError) -> &'static str {
    match err {
        TranValidationError::AgeOutOfRange => "age_out_of_range",
        TranValidationError::BirthdateInFuture => "birthdate_in_future",
        TranValidationError::InvalidBirthdate => "invalid_birthdate",
        TranValidationError::InvalidReferenceDate => "invalid_reference_date",
        TranValidationError::InvalidCountryCode => "invalid_country_code",
    }
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
            Ok(case.expected),
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
        assert_eq!(
            reason_code(res.reason),
            case.expected.reason_code,
            "{}",
            case.name
        );
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
        assert_eq!(validation_code(&err), case.code, "{}", case.name);
    }
}

#[test]
fn uniffi_rejects_every_invalid_birthdate_and_reference_date() {
    for raw in fixtures().invalid_birthdates {
        let as_birthdate = evaluate_vote_eligibility_offline(
            20,
            Some(raw.clone()),
            "US".into(),
            "2026-10-18".into(),
        );
        // An empty birthdate means "not given": the age is used instead.
        if raw.is_empty() {
            assert!(as_birthdate.is_ok());
        } else {
            assert_eq!(
                as_birthdate,
                Err(TranValidationError::InvalidBirthdate),
                "{raw:?}"
            );
        }
        assert_eq!(
            evaluate_vote_eligibility_offline(20, None, "US".into(), raw.clone()),
            Err(TranValidationError::InvalidReferenceDate),
            "{raw:?}"
        );
    }
}
