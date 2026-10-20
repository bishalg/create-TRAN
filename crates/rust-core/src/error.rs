use thiserror::Error;

use crate::validation::VoteValidationError;

/// Every way the core can refuse a request. Unexpected failures are not modelled here: the core is
/// pure, so anything else is a bug and surfaces as a panic the API turns into `server.internal`
/// (REQ-ROB-003).
#[derive(Error, Debug, PartialEq, Eq, Clone)]
pub enum CoreError {
    /// A rule rejected the input; carries the stable domain code (see `feedback::ErrorCode`).
    #[error("{0}")]
    ValidationError(VoteValidationError),
}

pub type CoreResult<T> = Result<T, CoreError>;
