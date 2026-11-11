use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use rust_core::feedback::ErrorCode;
use rust_core::TranHealthReport;

use crate::error::ApiError;
use crate::state::AppState;

pub async fn health_check_handler(State(state): State<AppState>) -> Json<TranHealthReport> {
    let report = state
        .engine
        .generate_health_report(state.uptime_seconds(), env!("CARGO_PKG_VERSION"));
    Json(report)
}

/// Liveness probe (REQ-OBS-007): 200 whenever the process can answer at all.
pub async fn liveness_handler() -> StatusCode {
    StatusCode::OK
}

/// Readiness probe (REQ-OBS-007): 200 `{ "ready": true }` while accepting work,
/// 503 `server.unavailable` in the error envelope once shutdown has begun.
pub async fn readiness_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if state.is_ready() {
        Ok(Json(serde_json::json!({ "ready": true })))
    } else {
        Err(ApiError::Rejected {
            code: ErrorCode::ServerUnavailable,
            message: "Server is shutting down".to_string(),
        })
    }
}
