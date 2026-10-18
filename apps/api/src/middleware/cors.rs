use axum::http::{header, HeaderName, HeaderValue, Method};
use tower_http::cors::CorsLayer;

pub fn create_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse::<HeaderValue>().unwrap(),
            "http://127.0.0.1:3000".parse::<HeaderValue>().unwrap(),
            "http://localhost:8081".parse::<HeaderValue>().unwrap(),
        ])
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            // Dev-only geo override sent by the web/native demo clients.
            HeaderName::from_static("x-debug-country"),
        ])
}
