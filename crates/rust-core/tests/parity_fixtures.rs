//! Golden-fixture parity: `fixtures/vote-eligibility.json` is shared with the TypeScript
//! mirror (`packages/core-ts/tests/parity.test.ts`). If a rule changes, edit the fixture first.

use chrono::NaiveDate;
use rust_core::{
    age_from_birthdate, can_vote_by_age, voting_age_for_country, CoreError, TranEngine,
    VoteEligibilityRequest,
};
use serde::Deserialize;

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

#[test]
fn voting_ages_match_fixture() {
    for case in fixtures().voting_ages {
        assert_eq!(
            voting_age_for_country(&case.country),
            case.minimum_age,
            "country {}",
            case.country
        );
    }
}

#[test]
fn can_vote_boundaries_match_fixture() {
    for case in fixtures().can_vote {
        assert_eq!(
            can_vote_by_age(case.age, case.minimum_age),
            case.expected,
            "age {} vs minimum {}",
            case.age,
            case.minimum_age
        );
    }
}

#[test]
fn age_from_birthdate_matches_fixture() {
    for case in fixtures().age_from_birthdate {
        assert_eq!(
            age_from_birthdate(case.birthdate, case.reference),
            case.expected,
            "{}",
            case.name
        );
    }
}

#[test]
fn invalid_birthdates_are_rejected_at_the_serde_boundary() {
    for raw in fixtures().invalid_birthdates {
        let body = serde_json::json!({ "age": 20, "birthdate": raw });
        assert!(
            serde_json::from_value::<VoteEligibilityRequest>(body).is_err(),
            "birthdate {raw:?} must not deserialize"
        );
    }
}

#[test]
fn evaluations_match_fixture() {
    let engine = TranEngine::new();
    for case in fixtures().evaluations {
        let res = engine
            .evaluate_vote_eligibility_on(
                case.input,
                &case.country_code,
                "fixture",
                "127.0.0.1",
                case.reference_date,
            )
            .unwrap_or_else(|e| panic!("{}: unexpected error {e}", case.name));

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
fn rejected_evaluations_match_fixture() {
    let engine = TranEngine::new();
    for case in fixtures().rejected_evaluations {
        let err = engine
            .evaluate_vote_eligibility_on(
                case.input,
                &case.country_code,
                "fixture",
                "127.0.0.1",
                case.reference_date,
            )
            .expect_err(&case.name);

        match err {
            CoreError::ValidationError(msg) => assert_eq!(msg, case.error, "{}", case.name),
            other => panic!("{}: expected ValidationError, got {other:?}", case.name),
        }
    }
}

#[test]
fn invalid_country_codes_are_rejected() {
    let engine = TranEngine::new();
    let today = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
    let raw: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    for code in raw["invalidCountryCodes"].as_array().unwrap() {
        let code = code.as_str().unwrap();
        let res = engine.evaluate_vote_eligibility_on(
            VoteEligibilityRequest {
                age: 30,
                birthdate: None,
            },
            code,
            "fixture",
            "127.0.0.1",
            today,
        );
        assert!(
            matches!(res, Err(CoreError::ValidationError(_))),
            "country {code:?} must be rejected"
        );
    }
}
