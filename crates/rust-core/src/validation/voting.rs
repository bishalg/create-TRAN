use chrono::NaiveDate;

use crate::error::{CoreError, CoreResult};
use crate::models::VoteEligibilityRequest;

pub const MAX_AGE: u16 = 150;

/// Rejects requests the rules cannot reason about. `today` is injected so the check is pure.
pub fn validate_vote_eligibility_request(
    req: &VoteEligibilityRequest,
    today: NaiveDate,
) -> CoreResult<()> {
    if req.age > MAX_AGE {
        return Err(CoreError::ValidationError(format!(
            "Age must be {MAX_AGE} or less"
        )));
    }
    if req.birthdate.is_some_and(|bd| bd > today) {
        return Err(CoreError::ValidationError(
            "Birthdate cannot be in the future".to_string(),
        ));
    }
    Ok(())
}

/// ISO 3166-1 alpha-2 shape check (two ASCII letters). Unknown-but-well-formed codes are allowed
/// and fall back to the default voting age.
pub fn validate_country_code(code: &str) -> CoreResult<()> {
    if code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()) {
        Ok(())
    } else {
        Err(CoreError::ValidationError(
            "Country code must be two ASCII letters (ISO 3166-1 alpha-2)".to_string(),
        ))
    }
}
