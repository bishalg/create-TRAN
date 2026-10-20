use axum::http::{header, HeaderName, HeaderValue, Method};
use tower_http::cors::CorsLayer;

pub fn create_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://localhost:3000"),
            HeaderValue::from_static("http://127.0.0.1:3000"),
            HeaderValue::from_static("http://localhost:8081"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            // Dev-only geo override sent by the web/native demo clients.
            HeaderName::from_static("x-debug-country"),
            HeaderName::from_static("x-request-id"),
        ])
        // Browsers may read the id so the UI can show it as a support reference (REQ-ERR-009).
        .expose_headers([HeaderName::from_static("x-request-id")])
}
