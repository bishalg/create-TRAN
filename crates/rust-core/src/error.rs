use thiserror::Error;

#[derive(Error, Debug, PartialEq, Eq, Clone)]
pub enum CoreError {
    #[error("Validation failed: {0}")]
    ValidationError(String),

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Execution error: {0}")]
    ExecutionError(String),

    #[error("Invalid state transition: {0}")]
    InvalidState(String),
}

pub type CoreResult<T> = Result<T, CoreError>;
