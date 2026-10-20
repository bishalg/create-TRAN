use chrono::NaiveDate;
use rust_core::{
    age_from_birthdate, can_vote_by_age, validate_vote_eligibility_request, voting_age_for_country,
    CoreError, StackLayer, TranEngine, VoteEligibilityRequest,
};

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
    let err =
        validate_vote_eligibility_request(&req, NaiveDate::from_ymd_opt(2026, 10, 18).unwrap())
            .expect_err("too old");
    assert!(matches!(err, CoreError::ValidationError(_)));
}

// Verifies: REQ-API-012
#[test]
fn health_report_lists_only_what_the_server_observes() {
    let report = TranEngine::new().generate_health_report(5, "9.9.9");
    assert_eq!(report.overall_status, "HEALTHY");

    let parts: Vec<(&StackLayer, &str, &str)> = report
        .components
        .iter()
        .map(|c| (&c.layer, c.name.as_str(), c.version.as_str()))
        .collect();
    assert_eq!(
        parts,
        vec![
            (
                &StackLayer::RustCore,
                "rust-core",
                env!("CARGO_PKG_VERSION")
            ),
            (&StackLayer::AxumApi, "axum-api", "9.9.9"),
        ]
    );
    assert!(report
        .components
        .iter()
        .all(|c| c.healthy && c.uptime_seconds == 5));
}

#[test]
fn engine_reports_unique_eligibility_ids() {
    let engine = TranEngine::new();
    let make = || {
        engine
            .evaluate_vote_eligibility(
                VoteEligibilityRequest {
                    age: 30,
                    birthdate: None,
                },
                "US",
                "test",
                "127.0.0.1",
            )
            .unwrap()
    };
    assert_ne!(make().eligibility_id, make().eligibility_id);
}
