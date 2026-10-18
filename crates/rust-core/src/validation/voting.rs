use crate::error::{CoreError, CoreResult};
use crate::models::VoteEligibilityRequest;

pub fn validate_vote_eligibility_request(req: &VoteEligibilityRequest) -> CoreResult<()> {
    if req.age > 150 {
        return Err(CoreError::ValidationError(
            "Age must be 150 or less".to_string(),
        ));
    }
    Ok(())
}
