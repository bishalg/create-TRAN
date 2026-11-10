//! The auth endpoints, account deletion and the device registry refuse a browser on a foreign
//! origin (REQ-SEC-012, REQ-ACC-001, REQ-PSH-001), the third CSRF defence after `SameSite=Strict`
//! and the cookie's narrow path (ADR-0039). A request without `Origin` (a native app, a server)
//! is not a browser's cross-site request and passes.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;

const SESSION_TREES: [&str; 3] = ["/api/auth", "/api/account", DEVICES_TREE];

/// Where the device registry lives; the segment after it is an installation id.
const DEVICES_TREE: &str = "/api/devices";

/// `path` as it may be logged: an installation id is replaced by its route's placeholder, so the
/// request span never carries one (REQ-PSH-007).
pub fn loggable_path(path: &str) -> &str {
    match path.strip_prefix(DEVICES_TREE) {
        Some(rest) if rest.starts_with('/') => "/api/devices/{installation_id}",
        _ => path,
    }
}

/// The trees that start, use up or end a session, or bind something to one: `/api/auth`,
/// `/api/account` and `/api/devices`, each with everything under it. They get the `Origin` check
/// and `Cache-Control: no-store`.
pub fn is_session_path(path: &str) -> bool {
    SESSION_TREES.iter().any(|tree| {
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

    // Verifies: REQ-SEC-012 REQ-ACC-001 REQ-PSH-001
    #[test]
    fn only_the_auth_account_and_devices_trees_are_session_paths() {
        assert!(is_session_path("/api/auth"));
        assert!(is_session_path("/api/auth/session"));
        assert!(is_session_path("/api/account"));
        assert!(is_session_path("/api/account/export"));
        assert!(is_session_path(
            "/api/devices/2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c"
        ));
        assert!(!is_session_path("/api/authority"));
        assert!(!is_session_path("/api/accounts"));
        assert!(!is_session_path("/api/devicesx"));
        assert!(!is_session_path("/api/health"));
    }

    // Verifies: REQ-PSH-007
    #[test]
    fn an_installation_id_never_reaches_a_logged_path() {
        let id = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c";
        let template = "/api/devices/{installation_id}";
        assert_eq!(loggable_path(&format!("/api/devices/{id}")), template);
        assert_eq!(loggable_path(&format!("/api/devices/{id}/extra")), template);
        assert_eq!(loggable_path("/api/devices/"), template);
        assert_eq!(loggable_path("/api/devices"), "/api/devices");
        assert_eq!(loggable_path("/api/devicesx"), "/api/devicesx");
        assert_eq!(loggable_path("/api/health"), "/api/health");
    }
}
