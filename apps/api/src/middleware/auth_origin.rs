//! The auth endpoints and account deletion refuse a browser on a foreign origin (REQ-SEC-012,
//! REQ-ACC-001), the third CSRF defence after `SameSite=Strict` and the cookie's narrow path
//! (ADR-0039). A request without `Origin` (a native app, a server) is not a browser's cross-site
//! request and passes.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;

/// The trees that start, use up or end a session: `/api/auth` and `/api/account`, each with
/// everything under it. They get the `Origin` check and `Cache-Control: no-store`.
pub fn is_session_path(path: &str) -> bool {
    ["/api/auth", "/api/account"].iter().any(|tree| {
        path.strip_prefix(tree)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

pub async fn auth_origin(
    State(allowed): State<Arc<[String]>>,
    request: Request,
    next: Next,
) -> Response {
    let foreign = is_session_path(request.uri().path())
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

    // Verifies: REQ-SEC-012 REQ-ACC-001
    #[test]
    fn only_the_auth_and_account_trees_are_session_paths() {
        assert!(is_session_path("/api/auth"));
        assert!(is_session_path("/api/auth/session"));
        assert!(is_session_path("/api/account"));
        assert!(is_session_path("/api/account/export"));
        assert!(!is_session_path("/api/authority"));
        assert!(!is_session_path("/api/accounts"));
        assert!(!is_session_path("/api/health"));
    }
}
