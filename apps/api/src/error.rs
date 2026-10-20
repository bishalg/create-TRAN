//! The one error envelope (REQ-ERR-002) and server-side failure logging (REQ-ERR-003).
//!
//! Status, retryability and log level come from `rust_core::feedback::ErrorCode::spec`; this file
//! only renders them. `error` is a developer message — clients show the localized copy for `code`.

use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rust_core::feedback::{ErrorCode, LogLevel};
use rust_core::CoreError;
use serde_json::json;
use uuid::Uuid;

tokio::task_local! {
    /// Set per request by `middleware::request_id`; read when an error is rendered.
    pub static REQUEST_ID: String;
}

/// What clients see for any 5xx: the real cause stays in the server log.
pub const GENERIC_SERVER_MESSAGE: &str = "Internal server error";

#[derive(Debug)]
pub enum ApiError {
    Core(CoreError),
    /// Unexpected failure; the cause is logged, never sent.
    Internal(String),
    /// A known catalogue failure with a developer message: an unusable request (unreadable body,
    /// unknown route, wrong method) or an overloaded server (deadline exceeded).
    Rejected {
        code: ErrorCode,
        message: String,
    },
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        ApiError::Core(err)
    }
}

/// Body rejections answer with fixed text: serde's own messages quote the submitted value, which
/// would put the payload in the response and the log (REQ-ROB-007).
impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        let (code, message) = match rejection.status() {
            StatusCode::UNSUPPORTED_MEDIA_TYPE => (
                ErrorCode::RequestUnsupportedMediaType,
                "Expected a JSON body (Content-Type: application/json)",
            ),
            StatusCode::PAYLOAD_TOO_LARGE => (
                ErrorCode::RequestTooLarge,
                "The body is larger than the server accepts",
            ),
            _ => match rejection {
                JsonRejection::JsonDataError(_) => (
                    ErrorCode::RequestMalformed,
                    "The body does not match the expected shape (see docs/API.md)",
                ),
                _ => (ErrorCode::RequestMalformed, "The body is not valid JSON"),
            },
        };
        ApiError::Rejected {
            code,
            message: message.to_string(),
        }
    }
}

/// A rendered failure: what goes on the wire, plus the cause that only goes to the log.
#[derive(Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: ErrorCode,
    pub message: String,
    pub cause: Option<String>,
}

impl ApiError {
    pub fn failure(self) -> Failure {
        let internal = |cause: String| Failure {
            code: ErrorCode::ServerInternal,
            message: GENERIC_SERVER_MESSAGE.to_string(),
            cause: Some(cause),
        };
        match self {
            ApiError::Core(CoreError::ValidationError(err)) => Failure {
                code: err.into(),
                message: err.to_string(),
                cause: None,
            },
            ApiError::Internal(cause) => internal(cause),
            ApiError::Rejected { code, message } => Failure {
                code,
                message,
                cause: None,
            },
        }
    }
}

/// The current request's id, or a fresh one outside a request scope (unit tests).
pub fn current_request_id() -> String {
    REQUEST_ID
        .try_with(Clone::clone)
        .unwrap_or_else(|_| Uuid::new_v4().to_string())
}

/// The status a code answers with; client-only codes never reach the wire, so they answer 500.
fn http_status(code: ErrorCode) -> StatusCode {
    code.spec()
        .http_status
        .and_then(|s| StatusCode::from_u16(s).ok())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

/// The one `request failed` event per failure, with `LOG_EVENT`'s fields (REQ-ROB-007).
fn log(failure: &Failure, request_id: &str) {
    let code = failure.code.as_str();
    let status = http_status(failure.code).as_u16();
    let detail = failure.cause.as_deref().unwrap_or(&failure.message);
    match failure.code.spec().log_level {
        LogLevel::Debug => tracing::debug!(code, status, request_id, detail, "request failed"),
        LogLevel::Info => tracing::info!(code, status, request_id, detail, "request failed"),
        LogLevel::Warn => tracing::warn!(code, status, request_id, detail, "request failed"),
        LogLevel::Error => tracing::error!(code, status, request_id, detail, "request failed"),
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let failure = self.failure();
        let spec = failure.code.spec();
        let request_id = current_request_id();
        log(&failure, &request_id);

        let status = http_status(failure.code);
        let body = Json(json!({
            "success": false,
            "error": failure.message,
            "code": failure.code.as_str(),
            "retryable": spec.retryable,
            "request_id": request_id,
        }));
        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use rust_core::VoteValidationError;
    use std::sync::{Arc, Mutex};
    use tracing::field::{Field, Visit};
    use tracing_subscriber::layer::{Context, SubscriberExt};
    use tracing_subscriber::Layer;

    async fn render(err: ApiError) -> (StatusCode, serde_json::Value) {
        let response = REQUEST_ID
            .scope("req-1".to_string(), async { err.into_response() })
            .await;
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    // Verifies: REQ-ERR-002
    #[tokio::test]
    async fn every_variant_renders_the_envelope_with_its_catalogue_status() {
        let cases = [
            (
                ApiError::Core(CoreError::ValidationError(
                    VoteValidationError::InvalidCountryCode,
                )),
                StatusCode::BAD_REQUEST,
                "validation.invalid_country_code",
                false,
            ),
            (
                ApiError::Rejected {
                    code: ErrorCode::RouteNotFound,
                    message: "n".into(),
                },
                StatusCode::NOT_FOUND,
                "route.not_found",
                false,
            ),
            (
                ApiError::Internal("e".into()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "server.internal",
                true,
            ),
            (
                ApiError::Rejected {
                    code: ErrorCode::RequestUnsupportedMediaType,
                    message: "m".into(),
                },
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "request.unsupported_media_type",
                false,
            ),
            (
                ApiError::Rejected {
                    code: ErrorCode::NetworkOffline,
                    message: "client-only code".into(),
                },
                StatusCode::INTERNAL_SERVER_ERROR,
                "network.offline",
                true,
            ),
        ];
        for (err, status, code, retryable) in cases {
            let (got_status, body) = render(err).await;
            assert_eq!(got_status, status, "{code}");
            assert_eq!(body["success"], false);
            assert_eq!(body["code"], code);
            assert_eq!(body["retryable"], retryable, "{code}");
            assert_eq!(body["request_id"], "req-1");
        }
    }

    // Verifies: REQ-ERR-003
    #[test]
    fn server_failures_answer_generically_and_keep_the_cause() {
        let failure = ApiError::Internal("db password wrong".into()).failure();
        assert_eq!(failure.message, GENERIC_SERVER_MESSAGE);
        assert_eq!(failure.cause.as_deref(), Some("db password wrong"));
    }

    #[test]
    fn outside_a_request_a_fresh_id_is_generated() {
        assert!(Uuid::parse_str(&current_request_id()).is_ok());
    }

    /// Collects `(level, code, request_id)` of every event.
    #[derive(Clone, Default)]
    struct Captured(Arc<Mutex<Vec<(tracing::Level, String, String)>>>);

    #[derive(Default)]
    struct Fields {
        code: String,
        request_id: String,
    }

    impl Visit for Fields {
        fn record_str(&mut self, field: &Field, value: &str) {
            match field.name() {
                "code" => self.code = value.to_string(),
                "request_id" => self.request_id = value.to_string(),
                _ => {}
            }
        }
        fn record_debug(&mut self, _field: &Field, _value: &dyn std::fmt::Debug) {}
    }

    impl<S: tracing::Subscriber> Layer<S> for Captured {
        fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
            let mut fields = Fields::default();
            event.record(&mut fields);
            self.0.lock().unwrap().push((
                *event.metadata().level(),
                fields.code,
                fields.request_id,
            ));
        }
    }

    // Verifies: REQ-ERR-003
    #[test]
    fn failures_are_logged_at_their_catalogue_level_with_the_request_id() {
        let captured = Captured::default();
        let subscriber = tracing_subscriber::registry().with(captured.clone());
        tracing::subscriber::with_default(subscriber, || {
            for code in [
                ErrorCode::ValidationAgeOutOfRange,
                ErrorCode::NetworkOffline,
                ErrorCode::RequestMalformed,
                ErrorCode::ServerInternal,
            ] {
                let failure = Failure {
                    code,
                    message: "m".into(),
                    cause: None,
                };
                log(&failure, "req-7");
            }
        });
        let events = captured.0.lock().unwrap().clone();
        let levels: Vec<tracing::Level> = events.iter().map(|e| e.0).collect();
        assert_eq!(
            levels,
            [
                tracing::Level::DEBUG,
                tracing::Level::INFO,
                tracing::Level::WARN,
                tracing::Level::ERROR
            ]
        );
        assert!(events.iter().all(|e| e.2 == "req-7"));
        assert_eq!(events[3].1, "server.internal");
    }
}
