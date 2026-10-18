pub mod config;
pub mod geo;
pub mod error;
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

pub async fn run_server(config: AppConfig) -> Result<(), Box<dyn std::error::Error>> {
    let state = AppState::new();
    let app = build_app(state);

    let listener = tokio::net::TcpListener::bind(&config.socket_addr()).await?;
    tracing::info!("Server listening on http://{}", config.socket_addr());

    axum::serve(listener, app).await?;
    Ok(())
}
