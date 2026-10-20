use axum::extract::State;
use axum::Json;
use rust_core::TranHealthReport;

use crate::state::AppState;

pub async fn health_check_handler(State(state): State<AppState>) -> Json<TranHealthReport> {
    let report = state
        .engine
        .generate_health_report(state.uptime_seconds(), env!("CARGO_PKG_VERSION"));
    Json(report)
}
