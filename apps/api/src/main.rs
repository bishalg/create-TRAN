use api::config::{AppConfig, LogFormat};
use api::middleware::install_panic_hook;
use api::run_server;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() {
    let config = AppConfig::from_env();
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(config.default_log_filter()));
    let registry = tracing_subscriber::registry().with(filter);
    match config.log_format() {
        LogFormat::Json => registry
            .with(
                fmt::layer()
                    .json()
                    .flatten_event(true)
                    .with_current_span(true)
                    .with_span_list(false),
            )
            .init(),
        LogFormat::Pretty => registry.with(fmt::layer()).init(),
    }
    install_panic_hook();

    tracing::info!(environment = %config.environment, "Initializing TRAN Axum API service");
    if let Err(err) = run_server(config).await {
        tracing::error!(%err, "server stopped");
        std::process::exit(1);
    }
}
