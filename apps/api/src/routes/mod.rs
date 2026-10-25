//! HTTP route modules — see `docs/API.md` for request/response samples.

pub mod health;
pub mod tran;
pub mod vote;

use axum::routing::{get, post};
use axum::Router;

use rust_core::feedback::ErrorCode;

use crate::error::ApiError;
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health_check_handler))
        .route("/api/tran/info", get(tran::stack_info_handler))
        .route("/api/vote/countries", get(vote::list_countries_handler))
        .route("/api/vote/countries/{code}", get(vote::get_country_handler))
        .route("/api/vote/eligibility", post(vote::eligibility_handler))
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .with_state(state)
}

/// Unknown routes use the same envelope as every other failure (REQ-ERR-002).
async fn not_found() -> ApiError {
    ApiError::Rejected {
        code: ErrorCode::RouteNotFound,
        message: "No route matches this path".to_string(),
    }
}

async fn method_not_allowed() -> ApiError {
    ApiError::Rejected {
        code: ErrorCode::RouteMethodNotAllowed,
        message: "This route does not accept that method".to_string(),
    }
}
