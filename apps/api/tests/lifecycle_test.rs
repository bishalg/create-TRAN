// Verifies: REQ-OBS-007 REQ-OBS-008 REQ-OBS-009
//! Process lifecycle, health probes, graceful drain, and start-up logging (spec 023).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::net::SocketAddr;
use std::time::Duration;

use api::config::AppConfig;
use api::state::AppState;
use api::{build_app, serve_with_shutdown};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use support::Captured;
use tokio::sync::{oneshot, Mutex};
use tower::ServiceExt;
use tracing::Level;

static SERIAL: Mutex<()> = Mutex::const_new(());

#[tokio::test]
async fn liveness_answers_200() {
    let app = build_app(AppState::new());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/health/live")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn readiness_answers_200_when_ready_and_503_when_shutting_down() {
    let state = AppState::new();
    let app = build_app(state.clone());

    // When ready: answers 200 {"ready": true}
    let req1 = Request::builder()
        .method(Method::GET)
        .uri("/api/health/ready")
        .body(Body::empty())
        .unwrap();

    let res1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::OK);
    let bytes1 = res1.into_body().collect().await.unwrap().to_bytes();
    let body1: Value = serde_json::from_slice(&bytes1).unwrap();
    assert_eq!(body1["ready"], true);

    // When not ready (shutdown started): answers 503 with envelope
    state.set_ready(false);

    let req2 = Request::builder()
        .method(Method::GET)
        .uri("/api/health/ready")
        .body(Body::empty())
        .unwrap();

    let res2 = app.oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::SERVICE_UNAVAILABLE);
    let bytes2 = res2.into_body().collect().await.unwrap().to_bytes();
    let body2: Value = serde_json::from_slice(&bytes2).unwrap();
    assert_eq!(body2["success"], false);
    assert_eq!(body2["code"], "server.unavailable");
}

#[tokio::test]
async fn health_keeps_its_report() {
    let app = build_app(AppState::new());
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/health")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["overall_status"], "HEALTHY");
    assert!(body["report_id"].is_string());
}

#[tokio::test]
async fn shutdown_drains_and_logs_lifecycle_events() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();

    let state = AppState::new();
    let app = build_app(state.clone());
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let server_task = tokio::spawn(serve_with_shutdown(
        listener,
        app,
        state.clone(),
        Box::pin(async move {
            let _ = shutdown_rx.await;
        }),
        5000,
    ));

    // Client connects while running over a real TCP stream
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(b"GET /api/health/live HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut response_text = String::new();
    stream.read_to_string(&mut response_text).await.unwrap();
    assert!(response_text.starts_with("HTTP/1.1 200 OK"));

    // Trigger graceful shutdown
    assert!(state.is_ready());
    shutdown_tx.send(()).unwrap();

    // Await server drain and exit
    let server_res = tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server must exit within timeout")
        .unwrap();
    assert!(server_res.is_ok());

    // Once shutdown has begun, ready is false
    assert!(!state.is_ready());

    // Verify shutdown events were logged
    let started_events = captured.named("shutdown started");
    assert_eq!(started_events.len(), 1, "missing 'shutdown started' event");

    let complete_events = captured.named("shutdown complete");
    assert_eq!(
        complete_events.len(),
        1,
        "missing 'shutdown complete' event"
    );
}

fn server_config(pairs: &'static [(&'static str, &'static str)]) -> AppConfig {
    AppConfig::from_lookup(|key| {
        let defaults = [
            ("HOST", "127.0.0.1"),
            ("PORT", "0"),
            ("DATABASE_URL", "sqlite::memory:"),
            ("MIGRATE_ON_START", "true"),
        ];
        pairs
            .iter()
            .chain(defaults.iter())
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
    })
}

// Verifies: REQ-OBS-009
#[tokio::test]
async fn startup_event_says_what_is_running() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();

    // The real start: bind, log, then the shutdown signal fires at once.
    let config = server_config(&[("APP_ENV", "staging")]);
    api::run_server_with_shutdown(config, Box::pin(async {}))
        .await
        .unwrap();

    let events = captured.named("service started");
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.level, Level::INFO);
    assert_eq!(event.field("version"), Some(env!("CARGO_PKG_VERSION")));
    assert_eq!(event.field("commit"), Some(api::metrics::BUILD_COMMIT));
    assert_eq!(event.field("environment"), Some("staging"));
    let listening = event.field("listening_address").unwrap();
    assert!(listening.starts_with("127.0.0.1:"), "{listening}");
    assert!(
        !listening.ends_with(":0"),
        "the bound port, not the configured 0"
    );
    assert_eq!(event.field("metrics_address"), Some("off"));

    // No secret, no environment dump.
    let line = event.line();
    assert!(!line.contains("DATABASE_URL"));
    assert!(!line.contains("sqlite"));
}

// Verifies: REQ-OBS-009
#[tokio::test]
async fn startup_event_comes_only_after_every_listener_is_bound() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let taken = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let busy: &'static str = Box::leak(taken.local_addr().unwrap().to_string().into_boxed_str());
    let pairs: &'static [(&str, &str)] = Box::leak(Box::new([("METRICS_ADDR", busy)]));
    let result =
        api::run_server_with_shutdown(server_config(pairs), Box::pin(std::future::pending())).await;
    assert!(result.is_err());
    assert!(captured.named("service started").is_empty());
}

// Verifies: REQ-OBS-006 REQ-OBS-008 REQ-DEP-003
#[tokio::test]
async fn a_malformed_setting_stops_the_start_naming_its_variable() {
    for (name, value) in [
        ("PORT", "abc"),
        ("METRICS_ADDR", "off"),
        ("SHUTDOWN_GRACE_MS", "soon"),
        ("TRUSTED_PROXIES", "10.0.0.300"),
        ("RATE_LIMIT_AUTH", "0"),
        ("RATE_MAX_IN_FLIGHT", "-5"),
    ] {
        let pairs: &'static [(&str, &str)] = Box::leak(Box::new([(name, value)]));
        let error = api::run_server_with_shutdown(server_config(pairs), Box::pin(async {}))
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert!(error.to_string().starts_with(name), "{name}: {error}");
        assert!(!error.to_string().contains(value), "{name}: {error}");
    }
}

#[tokio::test]
async fn shutdown_drains_times_out_on_hung_request() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();

    let state = AppState::new();
    let started = std::sync::Arc::new(tokio::sync::Notify::new());
    let started_clone = started.clone();
    let release = std::sync::Arc::new(tokio::sync::Notify::new());
    let release_clone = release.clone();

    let hung_app = axum::Router::new().route(
        "/hang",
        axum::routing::get(move || {
            let started = started_clone.clone();
            let release = release_clone.clone();
            async move {
                started.notify_one();
                release.notified().await;
                "done"
            }
        }),
    );
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let server_task = tokio::spawn(serve_with_shutdown(
        listener,
        hung_app,
        state.clone(),
        Box::pin(async move {
            let _ = shutdown_rx.await;
        }),
        50,
    ));

    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    use tokio::io::AsyncWriteExt;
    stream
        .write_all(b"GET /hang HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();

    started.notified().await;
    shutdown_tx.send(()).unwrap();

    let server_res = tokio::time::timeout(Duration::from_secs(2), server_task)
        .await
        .expect("server must exit within timeout")
        .unwrap();
    assert!(server_res.is_ok());

    let complete_events = captured.named("shutdown complete");
    assert_eq!(complete_events.len(), 1);
    release.notify_waiters();
}

// Verifies: REQ-OBS-006 REQ-OBS-008
#[tokio::test]
async fn run_server_with_shutdown_serves_and_drains_with_metrics() {
    let _lock = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let config = server_config(&[("METRICS_ADDR", "127.0.0.1:0")]);
    let server_task = tokio::spawn(api::run_server_with_shutdown(
        config,
        Box::pin(async move {
            let _ = shutdown_rx.await;
        }),
    ));

    let started = loop {
        if let Some(event) = captured.named("service started").pop() {
            break event;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    let metrics_address = started.field("metrics_address").unwrap().to_string();
    let mut stream = tokio::net::TcpStream::connect(&metrics_address)
        .await
        .unwrap();
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(b"GET /metrics HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut scraped = String::new();
    stream.read_to_string(&mut scraped).await.unwrap();
    assert!(scraped.starts_with("HTTP/1.1 200 OK"), "{scraped}");
    assert!(scraped.contains("tran_build_info"), "{scraped}");

    shutdown_tx.send(()).unwrap();
    let res = tokio::time::timeout(Duration::from_secs(5), server_task)
        .await
        .expect("server must exit within timeout")
        .unwrap();
    assert!(res.is_ok());
    // One pair for the whole process, the metrics listener included.
    assert_eq!(captured.named("shutdown started").len(), 1);
    assert_eq!(captured.named("shutdown complete").len(), 1);
    assert!(tokio::net::TcpStream::connect(&metrics_address)
        .await
        .is_err());
}

#[tokio::test]
async fn run_server_reports_unbindable_metrics_address() {
    let lookup = |key: &str| match key {
        "HOST" => Some("127.0.0.1".to_string()),
        "PORT" => Some("0".to_string()),
        "METRICS_ADDR" => Some("256.256.256.256:0".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    assert!(
        api::run_server_with_shutdown(config, Box::pin(std::future::pending::<()>()))
            .await
            .is_err()
    );
}
