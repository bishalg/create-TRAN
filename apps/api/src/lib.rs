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
pub async fn run_server(config: AppConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = tokio::net::TcpListener::bind(&config.socket_addr()).await?;
    tracing::info!("Server listening on http://{}", config.socket_addr());
    Ok(serve(listener, build_app(AppState::new())).await?)
}

/// Serves `app` on an already-bound listener (tests bind port 0 and read the address back).
pub fn serve(
    listener: tokio::net::TcpListener,
    app: Router,
) -> impl std::future::Future<Output = std::io::Result<()>> {
    std::future::IntoFuture::into_future(axum::serve(listener, app))
}
