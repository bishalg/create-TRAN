pub mod config;
pub mod error;
pub mod geo;
pub mod middleware;
pub mod routes;
pub mod state;

use axum::Router;
use config::AppConfig;
use middleware::create_cors_layer;
use routes::create_router;
use state::AppState;

pub fn build_app(state: AppState) -> Router {
    create_router(state).layer(create_cors_layer())
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
