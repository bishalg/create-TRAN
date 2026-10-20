use chrono::NaiveDate;
use thiserror::Error;

use crate::error::{CoreError, CoreResult};
use crate::models::VoteEligibilityRequest;

pub const MAX_AGE: u16 = 150;

/// Domain failures raised while validating an eligibility request.
///
/// These are the stable codes shared with the native FFI. The HTTP layer still receives a
/// [`CoreError::ValidationError`] message, but native clients can branch on these variants instead
/// of parsing English prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum VoteValidationError {
    /// Age is above [`MAX_AGE`].
    #[error("Age must be {MAX_AGE} or less")]
    AgeOutOfRange,
    /// Birthdate is later than the injected reference date.
    #[error("Birthdate cannot be in the future")]
    BirthdateInFuture,
    /// Country code is not two ASCII letters (ISO 3166-1 alpha-2 shape).
    #[error("Country code must be two ASCII letters (ISO 3166-1 alpha-2)")]
    InvalidCountryCode,
}

/// Rejects requests the rules cannot reason about, returning a stable domain code.
///
/// `today` is injected so the check is pure.
pub fn validate_vote_eligibility(
    req: &VoteEligibilityRequest,
    today: NaiveDate,
) -> Result<(), VoteValidationError> {
    if req.age > MAX_AGE {
        return Err(VoteValidationError::AgeOutOfRange);
    }
    if req.birthdate.is_some_and(|bd| bd > today) {
        return Err(VoteValidationError::BirthdateInFuture);
    }
    Ok(())
}

/// Rejects requests the rules cannot reason about. `today` is injected so the check is pure.
pub fn validate_vote_eligibility_request(
    req: &VoteEligibilityRequest,
    today: NaiveDate,
) -> CoreResult<()> {
    validate_vote_eligibility(req, today).map_err(|err| CoreError::ValidationError(err.to_string()))
}

/// ISO 3166-1 alpha-2 shape check (two ASCII letters).
///
/// Unknown-but-well-formed codes are allowed and fall back to the default voting age.
pub fn validate_country_code_format(code: &str) -> Result<(), VoteValidationError> {
    if code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()) {
        Ok(())
    } else {
        Err(VoteValidationError::InvalidCountryCode)
    }
}

/// ISO 3166-1 alpha-2 shape check (two ASCII letters). Unknown-but-well-formed codes are allowed
/// and fall back to the default voting age.
pub fn validate_country_code(code: &str) -> CoreResult<()> {
    validate_country_code_format(code).map_err(|err| CoreError::ValidationError(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-FFI-002
    #[test]
    fn typed_validation_returns_domain_codes() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
        let too_old = VoteEligibilityRequest {
            age: MAX_AGE + 1,
            birthdate: None,
        };
        assert_eq!(
            validate_vote_eligibility(&too_old, today),
            Err(VoteValidationError::AgeOutOfRange)
        );

        let future_birthdate = VoteEligibilityRequest {
            age: 5,
            birthdate: NaiveDate::from_ymd_opt(2026, 10, 19),
        };
        assert_eq!(
            validate_vote_eligibility(&future_birthdate, today),
            Err(VoteValidationError::BirthdateInFuture)
        );

        assert_eq!(
            validate_country_code_format("USA"),
            Err(VoteValidationError::InvalidCountryCode)
        );
        assert_eq!(validate_country_code_format("np"), Ok(()));
    }
}
