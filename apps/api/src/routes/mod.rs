pub mod health;
pub mod tran;

use axum::routing::{get, post};
use axum::Router;

use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health_check_handler))
        .route("/api/tran/info", get(tran::stack_info_handler))
        .route("/api/tran/compute", post(tran::compute_handler))
        .with_state(state)
}
