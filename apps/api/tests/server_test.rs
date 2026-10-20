// Verifies: REQ-API-013
//! Real-socket smoke tests: the only place the TCP listener and `run_server` are exercised.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use api::config::AppConfig;
use api::state::AppState;
use api::{build_app, run_server, serve};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[tokio::test]
async fn serve_answers_http_over_a_real_socket() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(serve(listener, build_app(AppState::new())));

    let mut stream = TcpStream::connect(addr).await.unwrap();
    stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut raw = String::new();
    stream.read_to_string(&mut raw).await.unwrap();

    assert!(raw.starts_with("HTTP/1.1 200"), "{raw}");
    assert!(raw.contains("HEALTHY"));
    server.abort();
}

#[tokio::test]
async fn run_server_starts_on_the_configured_address() {
    // An active subscriber makes the `tracing::info!` startup log execute, as it does in production.
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_test_writer()
        .try_init();
    let config = AppConfig::from_lookup(|key| match key {
        "HOST" => Some("127.0.0.1".into()),
        "PORT" => Some("0".into()),
        _ => None,
    });
    let server = tokio::spawn(run_server(config));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!server.is_finished(), "server should keep running");
    server.abort();
}

#[tokio::test]
async fn run_server_reports_an_unbindable_address() {
    let config = AppConfig::from_lookup(|key| match key {
        "HOST" => Some("256.256.256.256".into()),
        _ => None,
    });
    assert!(run_server(config).await.is_err());
}
