pub mod account;
pub mod client_versions;
pub mod clock;
pub mod commands;
pub mod config;
pub mod config_source;
pub mod db;
pub mod devices;
pub mod error;
pub mod geo;
pub mod metrics;
pub mod middleware;
pub mod push;
pub mod rate_limit_store;
pub mod routes;
pub mod secret;
pub mod session_store;
pub mod sessions;
pub mod signed_in;
pub mod state;

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use config::AppConfig;
use middleware::{
    auth_origin, client_address, client_standing, create_cors_layer, deadline, deprecation,
    load_shed, panic_response, rate_limit, request_id, security_headers, LoadShedState,
    RateLimitState,
};
use routes::create_router;
use routes::table::{Route, ROUTES};
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
            // The largest valid request, a device registration with the longest FCM token, is
            // under 1.5 KiB.
            max_body_bytes: 16 * 1024,
        }
    }
}

pub fn build_app(state: AppState) -> Router {
    let edge = state.edge.clone();
    with_layers(create_router(state), Limits::default(), &edge)
}

/// The cross-cutting stack every route runs inside, outermost first: the security headers (so
/// even a CORS preflight carries them), CORS, the request id and the client's identity (so
/// everything below logs with both), the panic boundary (so a panic anywhere below, the limiter
/// included, answers the `500` envelope), the client's address (resolved once, REQ-RL-003), load
/// shedding, the rate limiter, the client's standing (a `426` before any handler), the deprecation
/// notice, the auth `Origin` check, the deadline and the body limit.
pub fn with_layers(router: Router, limits: Limits, edge: &EdgePolicy) -> Router {
    with_layers_and_routes(router, limits, edge, &ROUTES)
}

/// [`with_layers`] with another route table, so a test can prove the deprecation notice on a
/// route the sample does not deprecate (REQ-VER-007). The limiter classifies by the same table.
pub fn with_layers_and_routes(
    router: Router,
    limits: Limits,
    edge: &EdgePolicy,
    routes: &'static [Route],
) -> Router {
    let load_shed_state = LoadShedState {
        in_flight: edge.in_flight.clone(),
        max_in_flight: edge.rate_policy.max_in_flight,
    };
    let rate_limit_state = RateLimitState {
        edge: edge.clone(),
        routes,
    };

    router
        .layer(DefaultBodyLimit::max(limits.max_body_bytes))
        .layer(axum::middleware::from_fn_with_state(
            limits.deadline,
            deadline,
        ))
        .layer(axum::middleware::from_fn_with_state(
            edge.allowed_origins.clone(),
            auth_origin,
        ))
        .layer(axum::middleware::from_fn_with_state(routes, deprecation))
        .layer(axum::middleware::from_fn_with_state(
            edge.client_thresholds.clone(),
            client_standing,
        ))
        .layer(axum::middleware::from_fn_with_state(
            rate_limit_state,
            rate_limit,
        ))
        .layer(axum::middleware::from_fn_with_state(
            load_shed_state,
            load_shed,
        ))
        .layer(axum::middleware::from_fn_with_state(
            edge.trusted_proxies.clone(),
            client_address,
        ))
        .layer(CatchPanicLayer::custom(panic_response))
        .layer(axum::middleware::from_fn(request_id))
        .layer(create_cors_layer(&edge.allowed_origins))
        .layer(axum::middleware::from_fn_with_state(
            edge.requires_https,
            security_headers,
        ))
}

/// The private metrics router (REQ-OBS-006): served only on `METRICS_ADDR`.
pub fn create_metrics_router(state: AppState) -> Router {
    Router::new()
        .route("/metrics", axum::routing::get(metrics_handler))
        .with_state(state)
}

async fn metrics_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let body = state.render_metrics();
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    )
}

pub type ShutdownSignal = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

/// Checks every setting (as [`AppConfig::validate`] does), switches on the configured push senders, opens
/// the database (migrating it or refusing pending migrations, as `MIGRATE_ON_START` says), starts
/// the prune task, binds the configured addresses and serves until the process stops. A setting
/// that does not parse fails here, naming the variable and never its value.
pub async fn run_server(config: AppConfig) -> std::io::Result<()> {
    run_server_with_shutdown(config, Box::pin(std::future::pending::<()>())).await
}

/// Runs the server with an injectable shutdown signal (REQ-OBS-008). `service started` is logged
/// once every listener is bound (REQ-OBS-009); on the signal both listeners drain, and the one
/// pair of `shutdown started` / `shutdown complete` events brackets it.
pub async fn run_server_with_shutdown(
    config: AppConfig,
    shutdown: ShutdownSignal,
) -> std::io::Result<()> {
    let invalid = |error: String| std::io::Error::new(std::io::ErrorKind::InvalidInput, error);
    let addr = config.socket_addr().map_err(invalid)?;
    let metrics_addr = config.metrics_addr().map_err(invalid)?;
    let grace_ms = config.shutdown_grace_ms().map_err(invalid)?;
    config.trusted_proxies().map_err(invalid)?;
    config.rate_policy().map_err(invalid)?;
    client_versions::ClientThresholds::from_settings(&config.client_versions)
        .map_err(|error| invalid(error.to_string()))?;
    let providers = push::providers::PushProviders::from_settings(
        &config.push,
        push::providers::Endpoints::real(),
        std::sync::Arc::new(clock::SystemClock),
    )
    .map_err(|error| invalid(error.to_string()))?;
    providers.log_state();
    let db = commands::database_for_serving(&config).map_err(|failure| invalid(failure.message))?;
    let sessions = sessions::Sessions::sql(db, std::sync::Arc::new(clock::SystemClock));
    db::prune::spawn(sessions.clone(), db::DB_POLICY.prune_interval());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let metrics_listener = match metrics_addr {
        Some(metrics_addr) => Some(tokio::net::TcpListener::bind(metrics_addr).await?),
        None => None,
    };
    let state = AppState {
        sessions,
        push_providers: std::sync::Arc::new(providers),
        ..AppState::from_config(&config)
    };

    let metrics_address = metrics_listener
        .as_ref()
        .map_or_else(|| "off".to_string(), bound_address);
    let listening_address = bound_address(&listener);
    tracing::info!(
        version = metrics::BUILD_VERSION,
        commit = metrics::BUILD_COMMIT,
        environment = %config.environment,
        listening_address = %listening_address,
        metrics_address = %metrics_address,
        "service started"
    );

    // Dropped when shutdown begins, which tells the metrics listener to drain too.
    let (metrics_stop, mut metrics_stopped) = tokio::sync::watch::channel(());
    let metrics_server = metrics_listener.map(|bound| {
        let router = create_metrics_router(state.clone());
        tokio::spawn(std::future::IntoFuture::into_future(
            axum::serve(bound, router).with_graceful_shutdown(async move {
                let _ = metrics_stopped.changed().await;
            }),
        ))
    });
    let signal: ShutdownSignal = Box::pin(async move {
        shutdown.await;
        drop(metrics_stop);
    });

    let result =
        serve_with_shutdown(listener, build_app(state.clone()), state, signal, grace_ms).await;
    if let Some(metrics_server) = metrics_server {
        let _ = tokio::time::timeout(Duration::from_millis(grace_ms), metrics_server).await;
    }
    result
}

/// The address a listener is bound to (the real port when `0` was asked for).
fn bound_address(listener: &tokio::net::TcpListener) -> String {
    listener
        .local_addr()
        .map(|addr| addr.to_string())
        .unwrap_or_default()
}

/// Serves `app` on an already-bound listener with injectable shutdown signal and graceful drain (REQ-OBS-008).
pub async fn serve_with_shutdown(
    listener: tokio::net::TcpListener,
    app: Router,
    state: AppState,
    shutdown_signal: ShutdownSignal,
    grace_ms: u64,
) -> std::io::Result<()> {
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    );

    let (drain_tx, drain_rx) = tokio::sync::oneshot::channel::<()>();

    let shutdown_trigger = async move {
        shutdown_signal.await;
        state.set_ready(false);
        tracing::info!("shutdown started");
        let _ = drain_tx.send(());
    };

    let graceful = server.with_graceful_shutdown(shutdown_trigger);

    tokio::select! {
        biased;
        _ = async {
            let _ = drain_rx.await;
            tokio::time::sleep(std::time::Duration::from_millis(grace_ms)).await;
        } => {
    tracing::info!("shutdown complete");
            Ok(())
        }
        res = graceful => {
    tracing::info!("shutdown complete");
            res
        }
    }
}

/// Serves `app` on an already-bound listener (tests bind port 0 and read the address back).
pub fn serve(
    listener: tokio::net::TcpListener,
    app: Router,
) -> impl std::future::Future<Output = std::io::Result<()>> {
    std::future::IntoFuture::into_future(axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    ))
}
