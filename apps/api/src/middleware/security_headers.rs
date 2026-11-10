//! Security headers on every response (REQ-SEC-013). The API serves JSON only, so the policy
//! forbids everything a browser could do with it as a document; auth and account answers are never
//! cached.

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

use super::is_session_path;

pub const CONTENT_SECURITY_POLICY: &str = "default-src 'none'; frame-ancestors 'none'";
pub const STRICT_TRANSPORT_SECURITY: &str = "max-age=63072000; includeSubDomains";

/// `requires_https` adds HSTS (every environment but `development` and `test`).
pub async fn security_headers(
    State(requires_https): State<bool>,
    request: Request,
    next: Next,
) -> Response {
    let auth = is_session_path(request.uri().path());
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    let set = |value: &'static str| HeaderValue::from_static(value);
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, set("nosniff"));
    headers.insert(header::REFERRER_POLICY, set("no-referrer"));
    headers.insert(header::X_FRAME_OPTIONS, set("DENY"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        set(CONTENT_SECURITY_POLICY),
    );
    if requires_https {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            set(STRICT_TRANSPORT_SECURITY),
        );
    }
    if auth {
        headers.insert(header::CACHE_CONTROL, set("no-store"));
    }
    response
}
