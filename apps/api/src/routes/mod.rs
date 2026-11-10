//! HTTP route modules — see `docs/API.md` for request/response samples.

pub mod account;
pub mod auth;
pub mod devices;
pub mod health;
pub mod tran;
pub mod vote;

use axum::routing::{delete, get, post, put};
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
        .route(
            "/api/auth/session",
            post(auth::sign_in).get(auth::current_session),
        )
        .route("/api/auth/refresh", post(auth::refresh))
        .route("/api/auth/sign-out", post(auth::sign_out))
        .route("/api/account", delete(account::delete_account))
        .route(
            "/api/devices/{installation_id}",
            put(devices::register).delete(devices::unregister),
        )
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
