pub mod account;
pub mod clock;
pub mod config;
pub mod error;
pub mod geo;
pub mod middleware;
pub mod routes;
pub mod secret;
pub mod session_store;
pub mod sessions;
pub mod state;

use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use config::AppConfig;
use middleware::{
    auth_origin, create_cors_layer, deadline, panic_response, request_id, security_headers,
};
use routes::create_router;
use rust_core::feedback::SERVER_DEADLINE_MS;
use state::{AppState, EdgePolicy};
use tower_http::catch_panic::CatchPanicLayer;

/// What one request may cost the server (REQ-ROB-004).
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Longer and the request answers `503 server.unavailable`.
    pub deadline: Duration,
    /// Larger and the body answers `413 request.too_large`.
    pub max_body_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            deadline: Duration::from_millis(SERVER_DEADLINE_MS),
            // The largest valid request is under 100 bytes.
            max_body_bytes: 16 * 1024,
        }
    }
}

pub fn build_app(state: AppState) -> Router {
    let edge = state.edge.clone();
    with_layers(create_router(state), Limits::default(), &edge)
}

/// The cross-cutting stack every route runs inside, outermost first: the security headers (so
/// even a CORS preflight carries them), CORS, the request id (so everything below logs with it),
/// the auth `Origin` check, the panic boundary, the deadline and the body limit.
pub fn with_layers(router: Router, limits: Limits, edge: &EdgePolicy) -> Router {
    router
        .layer(DefaultBodyLimit::max(limits.max_body_bytes))
        .layer(axum::middleware::from_fn_with_state(
            limits.deadline,
            deadline,
        ))
        .layer(CatchPanicLayer::custom(panic_response))
        .layer(axum::middleware::from_fn_with_state(
            edge.allowed_origins.clone(),
            auth_origin,
        ))
        .layer(axum::middleware::from_fn(request_id))
        .layer(create_cors_layer(&edge.allowed_origins))
        .layer(axum::middleware::from_fn_with_state(
            edge.requires_https,
            security_headers,
        ))
}

/// Binds the configured address and serves until the process stops.
pub async fn run_server(config: AppConfig) -> std::io::Result<()> {
    let addr = config.socket_addr();
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "Server listening");
    serve(listener, build_app(AppState::from_config(&config))).await
}

/// Serves `app` on an already-bound listener (tests bind port 0 and read the address back).
pub fn serve(
    listener: tokio::net::TcpListener,
    app: Router,
) -> impl std::future::Future<Output = std::io::Result<()>> {
    std::future::IntoFuture::into_future(axum::serve(listener, app))
}
