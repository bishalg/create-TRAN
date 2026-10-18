use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rust_core::CoreError;
use serde_json::json;

#[derive(Debug)]
pub enum ApiError {
    Core(CoreError),
    Internal(String),
    /// Request could not be parsed (bad JSON, missing field, wrong content type).
    BadRequest {
        status: StatusCode,
        message: String,
    },
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        ApiError::Core(err)
    }
}

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        ApiError::BadRequest {
            status: rejection.status(),
            message: rejection.body_text(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::Core(CoreError::ValidationError(msg)) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Core(CoreError::NotFound(msg)) => (StatusCode::NOT_FOUND, msg),
            ApiError::Core(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            ApiError::BadRequest { status, message } => {
                // Axum reports unreadable bodies as 400/415/422; clients only need "400 vs 415".
                let status = if status == StatusCode::UNSUPPORTED_MEDIA_TYPE {
                    status
                } else {
                    StatusCode::BAD_REQUEST
                };
                (status, message)
            }
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(json!({
            "success": false,
            "error": error_message
        }));

        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn render(err: ApiError) -> (StatusCode, serde_json::Value) {
        let response = err.into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn every_variant_maps_to_a_status_and_the_uniform_envelope() {
        let cases = [
            (
                ApiError::Core(CoreError::ValidationError("v".into())),
                StatusCode::BAD_REQUEST,
                "v",
            ),
            (
                ApiError::Core(CoreError::NotFound("n".into())),
                StatusCode::NOT_FOUND,
                "n",
            ),
            (
                ApiError::Core(CoreError::ExecutionError("e".into())),
                StatusCode::INTERNAL_SERVER_ERROR,
                "Execution error: e",
            ),
            (
                ApiError::Internal("i".into()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "i",
            ),
            (
                ApiError::BadRequest {
                    status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    message: "m".into(),
                },
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "m",
            ),
            (
                ApiError::BadRequest {
                    status: StatusCode::UNPROCESSABLE_ENTITY,
                    message: "m".into(),
                },
                StatusCode::BAD_REQUEST,
                "m",
            ),
        ];
        for (err, status, message) in cases {
            let (got_status, body) = render(err).await;
            assert_eq!(got_status, status);
            assert_eq!(body["success"], false);
            assert_eq!(body["error"], message);
        }
    }
}
