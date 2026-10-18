use chrono::NaiveDate;
use rust_core::{
    age_from_birthdate, can_vote_by_age, validate_vote_eligibility_request, voting_age_for_country,
    CalculationRequest, CoreError, StackLayer, TranEngine, VoteEligibilityRequest,
};

#[test]
fn test_stack_layers_metadata() {
    assert_eq!(StackLayer::TanStackStart.code(), 'T');
    assert_eq!(StackLayer::RustCore.code(), 'R');
    assert_eq!(StackLayer::AxumApi.code(), 'A');
    assert_eq!(StackLayer::NativeMobile.code(), 'N');
}

#[test]
fn test_voting_age_by_country() {
    assert_eq!(voting_age_for_country("US"), 18);
    assert_eq!(voting_age_for_country("BR"), 16);
}

#[test]
fn test_can_vote_by_age() {
    assert!(!can_vote_by_age(17, 18));
    assert!(can_vote_by_age(18, 18));
}

#[test]
fn test_engine_vote_eligibility() {
    let engine = TranEngine::new();
    let req = VoteEligibilityRequest {
        age: 20,
        birthdate: None,
    };
    let res = engine
        .evaluate_vote_eligibility(req, "NP", "test", "127.0.0.1")
        .expect("eligibility");
    assert!(res.eligible);
    assert_eq!(res.minimum_age, 18);
}

#[test]
fn test_age_from_birthdate() {
    let birth = NaiveDate::from_ymd_opt(2008, 1, 1).unwrap();
    let today = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
    assert_eq!(age_from_birthdate(birth, today), 18);
}

#[test]
fn test_validation_invalid_age() {
    let req = VoteEligibilityRequest {
        age: 200,
        birthdate: None,
    };
    let err = validate_vote_eligibility_request(&req).expect_err("too old");
    assert!(matches!(err, CoreError::ValidationError(_)));
}

#[test]
fn test_engine_multiply_computation() {
    let engine = TranEngine::new();
    let req = CalculationRequest {
        a: 6.0,
        b: 7.0,
        operation: "multiply".to_string(),
    };
    let res = engine.compute(req).expect("multiply");
    assert_eq!(res.result, 42.0);
}

#[test]
fn test_engine_generate_health_report() {
    let engine = TranEngine::new();
    let report = engine.generate_health_report(120);
    assert_eq!(report.overall_status, "HEALTHY");
    assert_eq!(report.components.len(), 4);
}
