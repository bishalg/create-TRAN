use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rust_core::CoreError;
use serde_json::json;

#[derive(Debug)]
pub enum ApiError {
    Core(CoreError),
    Internal(String),
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        ApiError::Core(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::Core(CoreError::ValidationError(msg)) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Core(CoreError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg),
            ApiError::Core(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(json!({
            "success": false,
            "error": error_message
        }));

        (status, body).into_response()
    }
}
