//! Thin UniFFI surface over `rust-core` voting rules for iOS (Swift) and Android (Kotlin).

use chrono::NaiveDate;
use rust_core::{
    age_from_birthdate, can_vote_by_age, voting_age_for_country, CoreError, TranEngine,
    VoteEligibilityRequest,
};
use thiserror::Error as ThisError;
use uniffi::Record;

uniffi::setup_scaffolding!("tran_uniffi");

#[derive(Debug, ThisError, uniffi::Error)]
pub enum TranValidationError {
    #[error("{detail}")]
    ValidationError { detail: String },
}

impl TranValidationError {
    fn from_core(err: CoreError) -> Self {
        match err {
            CoreError::ValidationError(detail) => Self::ValidationError { detail },
            other => Self::ValidationError {
                detail: other.to_string(),
            },
        }
    }

    pub fn detail(&self) -> &str {
        match self {
            Self::ValidationError { detail } => detail,
        }
    }
}

#[derive(Record, Debug, Clone, PartialEq, Eq)]
pub struct VoteEligibilityOfflineResult {
    pub eligible: bool,
    pub age: u16,
    pub minimum_age: u16,
    pub country_code: String,
    pub reason: String,
}

fn parse_iso_date(label: &str, value: &str) -> Result<NaiveDate, TranValidationError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| TranValidationError::ValidationError {
        detail: format!("{label} must be ISO YYYY-MM-DD"),
    })
}

/// Minimum voting age for an ISO 3166-1 alpha-2 country code (case-insensitive).
#[uniffi::export]
pub fn voting_age_for_country_offline(country_code: String) -> u16 {
    voting_age_for_country(&country_code)
}

/// Whether `age` meets `minimum_age`.
#[uniffi::export]
pub fn can_vote_by_age_offline(age: u16, minimum_age: u16) -> bool {
    can_vote_by_age(age, minimum_age)
}

/// Whole years between ISO birth and reference dates (shared leap-day rules with rust-core).
#[uniffi::export]
pub fn age_from_birthdate_offline(birthdate_iso: String, reference_date_iso: String) -> u16 {
    let birth = NaiveDate::parse_from_str(&birthdate_iso, "%Y-%m-%d")
        .unwrap_or_else(|_| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap());
    let reference = NaiveDate::parse_from_str(&reference_date_iso, "%Y-%m-%d")
        .unwrap_or_else(|_| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap());
    age_from_birthdate(birth, reference)
}

/// Offline eligibility using the same engine path as Axum (`evaluate_vote_eligibility_on`).
///
/// `birthdate_iso` wins over `age` when present. `reference_date_iso` injects “today” for tests.
#[uniffi::export]
pub fn evaluate_vote_eligibility_offline(
    age: u16,
    birthdate_iso: Option<String>,
    country_code: String,
    reference_date_iso: String,
) -> Result<VoteEligibilityOfflineResult, TranValidationError> {
    let reference = parse_iso_date("reference_date", &reference_date_iso)?;
    let birthdate = match birthdate_iso {
        None => None,
        Some(raw) if raw.is_empty() => None,
        Some(raw) => Some(parse_iso_date("birthdate", &raw)?),
    };

    let request = VoteEligibilityRequest { age, birthdate };
    let engine = TranEngine::new();
    let response = engine
        .evaluate_vote_eligibility_on(request, &country_code, "offline", "127.0.0.1", reference)
        .map_err(TranValidationError::from_core)?;

    Ok(VoteEligibilityOfflineResult {
        eligible: response.eligible,
        age: response.age,
        minimum_age: response.minimum_age,
        country_code: response.country_code,
        reason: response.reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::CoreError;

    #[test]
    fn validation_error_detail_is_exposed() {
        let err = TranValidationError::ValidationError {
            detail: "bad field".into(),
        };
        assert_eq!(err.detail(), "bad field");
    }

    #[test]
    fn from_core_preserves_validation_errors() {
        let err = TranValidationError::from_core(CoreError::ValidationError("age".into()));
        assert_eq!(err.detail(), "age");
    }

    #[test]
    fn from_core_stringifies_non_validation_core_errors() {
        let err = TranValidationError::from_core(CoreError::NotFound("gone".into()));
        assert!(err.detail().contains("gone"));
    }

    #[test]
    fn invalid_reference_date_is_rejected() {
        let err = evaluate_vote_eligibility_offline(18, None, "US".into(), "not-a-date".into())
            .expect_err("reference must be ISO");
        assert_eq!(err.detail(), "reference_date must be ISO YYYY-MM-DD");
    }

    #[test]
    fn invalid_birthdate_is_rejected() {
        let err = evaluate_vote_eligibility_offline(
            18,
            Some("2026/10/18".into()),
            "US".into(),
            "2026-10-18".into(),
        )
        .expect_err("birthdate must be ISO");
        assert_eq!(err.detail(), "birthdate must be ISO YYYY-MM-DD");
    }

    #[test]
    fn empty_birthdate_string_is_ignored() {
        let res = evaluate_vote_eligibility_offline(
            25,
            Some(String::new()),
            "US".into(),
            "2026-10-18".into(),
        )
        .expect("eligible adult");
        assert!(res.eligible);
        assert_eq!(res.age, 25);
    }

    #[test]
    fn age_from_birthdate_offline_clamps_unparseable_dates() {
        assert_eq!(
            age_from_birthdate_offline("not-a-date".into(), "also-bad".into()),
            0,
        );
        assert_eq!(
            age_from_birthdate_offline("not-iso".into(), "2026-10-18".into()),
            age_from_birthdate(
                NaiveDate::from_ymd_opt(1970, 1, 1).unwrap(),
                NaiveDate::from_ymd_opt(2026, 10, 18).unwrap(),
            ),
        );
        assert_eq!(
            age_from_birthdate_offline("2000-06-15".into(), "bad".into()),
            age_from_birthdate(
                NaiveDate::from_ymd_opt(2000, 6, 15).unwrap(),
                NaiveDate::from_ymd_opt(1970, 1, 1).unwrap(),
            ),
        );
    }
}
