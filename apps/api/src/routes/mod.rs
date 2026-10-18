pub mod health;
pub mod tran;
pub mod vote;

use axum::routing::{get, post};
use axum::Router;

use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health_check_handler))
        .route("/api/tran/info", get(tran::stack_info_handler))
        .route("/api/vote/eligibility", post(vote::eligibility_handler))
        .with_state(state)
}
