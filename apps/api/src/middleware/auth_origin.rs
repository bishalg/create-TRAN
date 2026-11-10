//! The auth endpoints refuse a browser on a foreign origin (REQ-SEC-012), the third CSRF defence
//! after `SameSite=Strict` and the cookie's narrow path (ADR-0039). A request without `Origin` (a
//! native app, a server) is not a browser's cross-site request and passes.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;

/// `/api/auth` and everything under it.
pub fn is_auth_path(path: &str) -> bool {
    path.strip_prefix("/api/auth")
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

pub async fn auth_origin(
    State(allowed): State<Arc<[String]>>,
    request: Request,
    next: Next,
) -> Response {
    let foreign = is_auth_path(request.uri().path())
        && request
            .headers()
            .get(header::ORIGIN)
            .is_some_and(|origin| !allowed.iter().any(|a| a.as_bytes() == origin.as_bytes()));
    if foreign {
        // The origin is not echoed: header values never reach a response or a log (REQ-ROB-007).
        return ApiError::Rejected {
            code: ErrorCode::AuthForbidden,
            message: "This origin may not call the auth endpoints".to_string(),
        }
        .into_response();
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-SEC-012
    #[test]
    fn only_the_auth_tree_is_an_auth_path() {
        assert!(is_auth_path("/api/auth"));
        assert!(is_auth_path("/api/auth/session"));
        assert!(!is_auth_path("/api/authority"));
        assert!(!is_auth_path("/api/health"));
    }
}
