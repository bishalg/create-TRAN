//! HTTP route modules — see `docs/API.md` for request/response samples.
//!
//! Every product route lives under [`API_BASE_PATH`] and is declared once in [`table::ROUTES`];
//! health stays unversioned at [`HEALTH_PATH`] (REQ-VER-001). There are no unversioned aliases: an
//! old path, or an unknown version, answers `404 route.not_found` in the envelope.

pub mod account;
pub mod auth;
pub mod devices;
pub mod health;
pub mod table;
pub mod tran;
pub mod vote;

use axum::routing::get;
use axum::Router;

use rust_core::compat::{API_BASE_PATH, HEALTH_PATH};
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    table::ROUTES
        .iter()
        .fold(
            Router::new()
                .route(HEALTH_PATH, get(health::health_check_handler))
                .route("/api/health/live", get(health::liveness_handler))
                .route("/api/health/ready", get(health::readiness_handler)),
            |router, route| router.route(&route.template(), (route.handler)()),
        )
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .with_state(state)
}

/// Whether `path` is a product route's: the base path or anything below it. Only these meet the
/// client's standing (REQ-VER-005).
pub fn is_product_path(path: &str) -> bool {
    path.strip_prefix(API_BASE_PATH)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
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

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-VER-001
    #[test]
    fn only_the_versioned_tree_is_product() {
        assert!(is_product_path("/api/v1"));
        assert!(is_product_path("/api/v1/vote/eligibility"));
        assert!(!is_product_path("/api/v10/vote/eligibility"));
        assert!(!is_product_path("/api/health"));
        assert!(!is_product_path("/api/vote/eligibility"));
    }
}
