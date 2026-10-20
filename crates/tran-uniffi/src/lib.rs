//! Thin, documented UniFFI surface over `rust-core` voting rules for iOS (Swift) and Android (Kotlin).
//!
//! The generated bindings are the native developers' API: every exported item carries a rustdoc
//! comment so Xcode Quick Help and Android Studio KDoc show it without opening the Rust crate.
#![deny(missing_docs)]

use chrono::NaiveDate;
use rust_core::{
    age_from_birthdate, can_vote_by_age, parse_iso_date, resolve_destination,
    voting_age_for_country, AppDestination, AuthSession, CoreError, TranEngine, UserRole,
    VoteEligibilityRequest, VoteValidationError, SUPPORTED_COUNTRIES,
};
use thiserror::Error as ThisError;

uniffi::setup_scaffolding!("tran_uniffi");

mod feedback;
pub use feedback::*;

/// A validation failure that native code can branch on without parsing English prose.
///
/// Map these variants to localized copy in the app layer. The `Display` text is for Rust logs
/// only; it is never meant to be shown to a voter.
#[derive(Debug, Clone, PartialEq, Eq, ThisError, uniffi::Error)]
pub enum TranValidationError {
    /// The supplied age is above the supported maximum (150).
    #[error("Age must be 150 or less")]
    AgeOutOfRange,

    /// The birthdate is later than the reference date used for evaluation.
    #[error("Birthdate cannot be in the future")]
    BirthdateInFuture,

    /// The birthdate is not a valid ISO 8601 calendar date (`YYYY-MM-DD`).
    #[error("Birthdate must be a valid ISO 8601 date (YYYY-MM-DD)")]
    InvalidBirthdate,

    /// The reference date is not a valid ISO 8601 calendar date (`YYYY-MM-DD`).
    #[error("Reference date must be a valid ISO 8601 date (YYYY-MM-DD)")]
    InvalidReferenceDate,

    /// The country code is not two ASCII letters (ISO 3166-1 alpha-2 shape).
    #[error("Country code must be two ASCII letters (ISO 3166-1 alpha-2)")]
    InvalidCountryCode,
}

impl From<CoreError> for TranValidationError {
    fn from(err: CoreError) -> Self {
        match err {
            CoreError::ValidationError(err) => err.into(),
        }
    }
}

impl From<VoteValidationError> for TranValidationError {
    fn from(err: VoteValidationError) -> Self {
        match err {
            VoteValidationError::AgeOutOfRange => Self::AgeOutOfRange,
            VoteValidationError::BirthdateInFuture => Self::BirthdateInFuture,
            VoteValidationError::InvalidCountryCode => Self::InvalidCountryCode,
        }
    }
}

/// Why the eligibility verdict is what it is.
///
/// The native layer turns this into a localized sentence; the bridge never returns a
/// pre-formatted English reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranEligibilityReason {
    /// The voter meets the minimum voting age for the country.
    MeetsMinimumAge,

    /// The voter is below the minimum voting age for the country.
    BelowMinimumAge,
}

/// Offline eligibility result produced by the shared Rust rules.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct VoteEligibilityOfflineResult {
    /// Whether the voter meets the country's minimum voting age.
    pub eligible: bool,

    /// Age used for the decision, in whole years.
    pub age: u16,

    /// Minimum voting age for the supplied country.
    pub minimum_age: u16,

    /// Normalized ISO 3166-1 alpha-2 country code (upper case).
    pub country_code: String,

    /// Stable reason code for the verdict; map it to localized copy in the app.
    pub reason: TranEligibilityReason,
}

fn parse_reference_date(value: &str) -> Result<NaiveDate, TranValidationError> {
    parse_iso_date(value).ok_or(TranValidationError::InvalidReferenceDate)
}

fn parse_birthdate(value: &str) -> Result<NaiveDate, TranValidationError> {
    parse_iso_date(value).ok_or(TranValidationError::InvalidBirthdate)
}

/// Minimum voting age for an ISO 3166-1 alpha-2 country code (case-insensitive).
///
/// Unknown but well-formed codes fall back to the default voting age of 18.
///
/// # Arguments
///
/// * `country_code` — two-letter ISO 3166-1 alpha-2 code; matching is case-insensitive.
///
/// # Returns
///
/// The minimum age in whole years.
#[uniffi::export]
pub fn voting_age_for_country_offline(country_code: String) -> u16 {
    voting_age_for_country(&country_code)
}

/// Whether `age` meets `minimum_age`.
///
/// This is a pure comparison; it does not validate that `minimum_age` belongs to a real country.
///
/// # Arguments
///
/// * `age` — age in whole years.
/// * `minimum_age` — minimum voting age in whole years.
///
/// # Returns
///
/// `true` when `age` is greater than or equal to `minimum_age`.
#[uniffi::export]
pub fn can_vote_by_age_offline(age: u16, minimum_age: u16) -> bool {
    can_vote_by_age(age, minimum_age)
}

/// Whole years between two ISO 8601 dates, using the shared leap-day rules from `rust-core`.
///
/// # Arguments
///
/// * `birthdate_iso` — birthdate in `YYYY-MM-DD` form.
/// * `reference_date_iso` — the date to measure against, in `YYYY-MM-DD` form.
///
/// # Returns
///
/// Age in whole years; a birthdate after the reference date returns `0`.
///
/// # Errors
///
/// Returns [`TranValidationError::InvalidBirthdate`] or
/// [`TranValidationError::InvalidReferenceDate`] when either input is not a real calendar date.
#[uniffi::export]
pub fn age_from_birthdate_offline(
    birthdate_iso: String,
    reference_date_iso: String,
) -> Result<u16, TranValidationError> {
    let birthdate = parse_birthdate(&birthdate_iso)?;
    let reference = parse_reference_date(&reference_date_iso)?;
    Ok(age_from_birthdate(birthdate, reference))
}

/// Evaluate voting eligibility offline with the same rules as the Axum endpoint.
///
/// `birthdate_iso` wins over `age` when present. `reference_date_iso` injects "today" so tests are
/// deterministic; the apps pass the device date.
///
/// # Arguments
///
/// * `age` — age in whole years, used when `birthdate_iso` is absent or empty.
/// * `birthdate_iso` — optional birthdate in `YYYY-MM-DD` form; wins over `age`.
/// * `country_code` — two-letter ISO 3166-1 alpha-2 code; matching is case-insensitive.
/// * `reference_date_iso` — the date to evaluate against, in `YYYY-MM-DD` form.
///
/// # Returns
///
/// A [`VoteEligibilityOfflineResult`] with the verdict and the facts used to reach it.
///
/// # Errors
///
/// Returns [`TranValidationError`] when a date is malformed, the birthdate is in the future, the
/// age exceeds 150, or the country code is not two ASCII letters.
#[uniffi::export]
pub fn evaluate_vote_eligibility_offline(
    age: u16,
    birthdate_iso: Option<String>,
    country_code: String,
    reference_date_iso: String,
) -> Result<VoteEligibilityOfflineResult, TranValidationError> {
    let reference = parse_reference_date(&reference_date_iso)?;
    let birthdate = match birthdate_iso {
        None => None,
        Some(raw) if raw.is_empty() => None,
        Some(raw) => Some(parse_birthdate(&raw)?),
    };

    let request = VoteEligibilityRequest { age, birthdate };
    // The engine validates (age, derived age, birthdate, country) and its errors convert 1:1.
    let response = TranEngine::new().evaluate_vote_eligibility_on(
        request,
        &country_code,
        "offline",
        "127.0.0.1",
        reference,
    )?;

    let reason = if response.eligible {
        TranEligibilityReason::MeetsMinimumAge
    } else {
        TranEligibilityReason::BelowMinimumAge
    };

    Ok(VoteEligibilityOfflineResult {
        eligible: response.eligible,
        age: response.age,
        minimum_age: response.minimum_age,
        country_code: response.country_code,
        reason,
    })
}

/// A signed-in role. The app stores the session; Rust decides where it leads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranUserRole {
    /// A voter checking their own eligibility.
    CitizenVoter,

    /// An auditor reviewing the country rule table.
    ElectionAuditor,
}

/// The screen the navigation director routes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranAppDestination {
    /// Launch screen shown while the stored session is read. Never returned by
    /// [`resolve_destination_offline`]; the app shows it before asking.
    Splash,

    /// Role selection for a visitor without a session.
    AuthWelcome,

    /// The citizen voter's eligibility checker.
    VoterDashboard,

    /// The election auditor's country rule table.
    AuditorDashboard,
}

/// Where the app should go for the stored session.
///
/// # Arguments
///
/// * `role` — the signed-in role, or `None` when there is no session or the user signed out.
///
/// # Returns
///
/// The destination screen. The rules live in `rust-core` and are pinned by
/// `fixtures/navigation.json`.
#[uniffi::export]
pub fn resolve_destination_offline(role: Option<TranUserRole>) -> TranAppDestination {
    let session = role.map(|role| AuthSession::Authenticated {
        user_id: String::new(),
        role: match role {
            TranUserRole::CitizenVoter => UserRole::CitizenVoter,
            TranUserRole::ElectionAuditor => UserRole::ElectionAuditor,
        },
    });
    match resolve_destination(session.as_ref()) {
        AppDestination::Splash => TranAppDestination::Splash,
        AppDestination::AuthWelcome => TranAppDestination::AuthWelcome,
        AppDestination::VoterDashboard => TranAppDestination::VoterDashboard,
        AppDestination::AuditorDashboard => TranAppDestination::AuditorDashboard,
    }
}

/// One row of the supported-country table.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct TranCountryVotingAge {
    /// Upper-case ISO 3166-1 alpha-2 code.
    pub country_code: String,

    /// Minimum voting age in whole years.
    pub minimum_age: u16,
}

/// Every supported country with its minimum voting age, sorted by code.
///
/// # Returns
///
/// The same table that [`voting_age_for_country_offline`] reads, so screens that list the rules
/// can never disagree with the verdict.
#[uniffi::export]
pub fn supported_countries_offline() -> Vec<TranCountryVotingAge> {
    SUPPORTED_COUNTRIES
        .iter()
        .map(|c| TranCountryVotingAge {
            country_code: c.country_code.to_string(),
            minimum_age: c.minimum_age,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_reference_date_is_rejected() {
        let err = evaluate_vote_eligibility_offline(18, None, "US".into(), "not-a-date".into())
            .expect_err("reference must be ISO");
        assert!(matches!(err, TranValidationError::InvalidReferenceDate));
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
        assert!(matches!(err, TranValidationError::InvalidBirthdate));
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
        assert_eq!(res.reason, TranEligibilityReason::MeetsMinimumAge);
    }

    #[test]
    fn age_and_country_failures_use_domain_variants() {
        let too_old =
            evaluate_vote_eligibility_offline(151, None, "US".into(), "2026-10-18".into())
                .expect_err("age must be <= 150");
        assert!(matches!(too_old, TranValidationError::AgeOutOfRange));

        let bad_country =
            evaluate_vote_eligibility_offline(30, None, "USA".into(), "2026-10-18".into())
                .expect_err("country must be two letters");
        assert!(matches!(
            bad_country,
            TranValidationError::InvalidCountryCode
        ));
    }

    #[test]
    fn future_birthdate_uses_domain_variant() {
        let err = evaluate_vote_eligibility_offline(
            5,
            Some("2026-10-19".into()),
            "US".into(),
            "2026-10-18".into(),
        )
        .expect_err("birthdate cannot be in the future");
        assert!(matches!(err, TranValidationError::BirthdateInFuture));
    }

    #[test]
    fn underage_reason_is_typed() {
        let res = evaluate_vote_eligibility_offline(17, None, "US".into(), "2026-10-18".into())
            .expect("valid request");
        assert!(!res.eligible);
        assert_eq!(res.reason, TranEligibilityReason::BelowMinimumAge);
    }

    #[test]
    fn age_from_birthdate_reports_bad_dates() {
        assert!(matches!(
            age_from_birthdate_offline("not-a-date".into(), "2026-10-18".into()),
            Err(TranValidationError::InvalidBirthdate)
        ));
        assert!(matches!(
            age_from_birthdate_offline("2000-06-15".into(), "bad".into()),
            Err(TranValidationError::InvalidReferenceDate)
        ));
        assert_eq!(
            age_from_birthdate_offline("2000-06-15".into(), "2026-06-15".into()),
            Ok(26)
        );
    }
}
