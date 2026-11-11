use std::sync::Arc;

use api::clock::SystemClock;
use api::commands::{self, Command};
use api::config::{AppConfig, LogFormat};
use api::middleware::install_panic_hook;
use api::push::{manual, providers::Endpoints, sender::ProviderAnswer};
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

    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match commands::parse(&args) {
        Ok(command) => command,
        Err(usage) => {
            tracing::error!(usage, "unknown arguments");
            std::process::exit(2);
        }
    };
    match command {
        // Ring one device by hand (docs/PUSH.md), then exit.
        Command::SendTestPush => {
            let clock = Arc::new(SystemClock);
            match manual::run(&args[1..], &config.push, Endpoints::real(), clock).await {
                Ok(ProviderAnswer::Delivered) => {
                    tracing::info!("test push accepted by the provider")
                }
                Ok(answer) => {
                    tracing::error!(?answer, "test push not accepted");
                    std::process::exit(1);
                }
                Err(err) => {
                    tracing::error!(%err, "test push not sent");
                    std::process::exit(2);
                }
            }
        }
        // Validate configuration for environment before rollout (REQ-DEP-003).
        Command::CheckConfig => match commands::check_config(&config) {
            Ok(msg) => tracing::info!("{msg}"),
            Err(failure) => exit_with(failure),
        },
        // Apply or check migrations (docs/PERSISTENCE.md), then exit.
        Command::Migrate { check } => match commands::migrate(&config, check) {
            Ok(done) => tracing::info!("{done}"),
            Err(failure) => exit_with(failure),
        },
        // Delete expired rows once; `run_once` logs the counts.
        Command::Prune => {
            if let Err(failure) = commands::prune(&config).await {
                exit_with(failure);
            }
        }
        Command::Serve => {
            tracing::info!(environment = %config.environment, "Initializing TRAN Axum API service");
            if let Err(err) =
                api::run_server_with_shutdown(config, Box::pin(shutdown_signal())).await
            {
                tracing::error!(%err, "server stopped");
                std::process::exit(1);
            }
        }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        } else {
            std::future::pending::<()>().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

fn exit_with(failure: commands::Failure) -> ! {
    tracing::error!(error = %failure.message, "command failed");
    std::process::exit(failure.exit_code);
}
