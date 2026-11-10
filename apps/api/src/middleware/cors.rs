//! CORS from configuration (REQ-API-007): exact origins, never `*`, with credentials so the
//! refresh cookie of REQ-SEC-007 can travel.

use axum::http::{header, HeaderName, HeaderValue, Method};
use tower_http::cors::CorsLayer;

/// `origins` comes from `AppConfig::allowed_origins`; a value that is not a valid header is
/// skipped, so it can never match.
pub fn create_cors_layer(origins: &[String]) -> CorsLayer {
    let origins: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();
    CorsLayer::new()
        .allow_origin(origins)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::AUTHORIZATION,
            // Dev-only geo override sent by the web/native demo clients.
            HeaderName::from_static("x-debug-country"),
            HeaderName::from_static("x-request-id"),
            // Every app names itself (REQ-VER-004).
            HeaderName::from_static("x-tran-client"),
        ])
        // Browsers may read the id so the UI can show it as a support reference (REQ-ERR-009),
        // and the update nudge and a deprecation so the app can act on them (REQ-VER-006, 007).
        .expose_headers([
            HeaderName::from_static("x-request-id"),
            HeaderName::from_static("x-tran-update"),
            HeaderName::from_static("x-tran-recommended-version"),
            HeaderName::from_static("deprecation"),
            HeaderName::from_static("sunset"),
        ])
}
