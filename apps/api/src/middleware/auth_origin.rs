//! The auth endpoints, account deletion and the device registry refuse a browser on a foreign
//! origin (REQ-SEC-012, REQ-ACC-001, REQ-PSH-001), the third CSRF defence after `SameSite=Strict`
//! and the cookie's narrow path (ADR-0039). A request without `Origin` (a native app, a server)
//! is not a browser's cross-site request and passes.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::compat::API_BASE_PATH;
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;
use crate::routes::table::DEVICES_TREE;

/// Below [`API_BASE_PATH`]: the trees that hold or touch a session.
const SESSION_TREES: [&str; 3] = ["/auth", "/account", DEVICES_TREE];

/// The trees that start, use up or end a session, or bind something to one: `/api/v1/auth`,
/// `/api/v1/account` and `/api/v1/devices`, each with everything under it. They get the `Origin`
/// check and `Cache-Control: no-store`.
pub fn is_session_path(path: &str) -> bool {
    path.strip_prefix(API_BASE_PATH).is_some_and(|rest| {
        SESSION_TREES.iter().any(|tree| {
            rest.strip_prefix(tree)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
        })
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

    // Verifies: REQ-SEC-012 REQ-ACC-001 REQ-PSH-001
    #[test]
    fn only_the_auth_account_and_devices_trees_are_session_paths() {
        assert!(is_session_path("/api/v1/auth"));
        assert!(is_session_path("/api/v1/auth/session"));
        assert!(is_session_path("/api/v1/account"));
        assert!(is_session_path("/api/v1/account/export"));
        assert!(is_session_path(
            "/api/v1/devices/2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c"
        ));
        assert!(!is_session_path("/api/v1/authority"));
        assert!(!is_session_path("/api/v1/accounts"));
        assert!(!is_session_path("/api/v1/devicesx"));
        assert!(!is_session_path("/api/health"));
        // The unversioned paths are gone (REQ-VER-001): nothing there holds a session.
        assert!(!is_session_path("/api/auth/session"));
        assert!(!is_session_path("/api/v2/auth/session"));
    }
}
