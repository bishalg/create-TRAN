//! A request that runs past the server deadline answers `503 server.unavailable` with the envelope
//! instead of hanging until the client gives up (REQ-ROB-004).

use std::time::Duration;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;

pub async fn deadline(State(limit): State<Duration>, request: Request, next: Next) -> Response {
    match tokio::time::timeout(limit, next.run(request)).await {
        Ok(response) => response,
        Err(_) => ApiError::Rejected {
            code: ErrorCode::ServerUnavailable,
            message: format!("No response within {} ms", limit.as_millis()),
        }
        .into_response(),
    }
}
