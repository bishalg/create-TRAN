// Verifies: REQ-RL-007
//! Load shedding integration tests (spec 031, ADR-0050).
//!
//! Naming follows the spec's "Verified by" lines: `load_shed_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::atomic::Ordering;

use api::build_app;
use api::config::AppConfig;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    json: Value,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    fn retry_after(&self) -> Option<u64> {
        self.header("retry-after").and_then(|v| v.parse().ok())
    }
}

async fn send(state: &AppState, method: Method, uri: &str) -> Reply {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();
    let response = build_app(state.clone()).oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Reply {
        status,
        headers,
        json,
    }
}

// ── REQ-RL-007: Overload is shed early ────────────────────────────────────────

#[tokio::test]
async fn load_shed_answers_503_when_in_flight_exceeds_max() {
    let config = AppConfig::from_lookup(|key| match key {
        "RATE_MAX_IN_FLIGHT" => Some("2".to_string()),
        _ => None,
    });
    let state = AppState::from_config(&config);

    // Normal request under capacity succeeds
    let normal = send(&state, Method::GET, "/api/v1/vote/countries").await;
    assert_eq!(normal.status, StatusCode::OK);

    // Simulate in-flight requests at ceiling (>= max_in_flight: 2)
    state.edge.in_flight.store(2, Ordering::SeqCst);

    let shed = send(&state, Method::GET, "/api/v1/vote/countries").await;
    assert_eq!(shed.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(shed.json["code"], "server.unavailable");
    assert_eq!(shed.json["success"], false);
    assert_eq!(shed.json["retryable"], true);
    assert!(shed.json["request_id"].is_string());
    assert_eq!(shed.retry_after(), Some(1));

    // In-flight count was not permanently inflated by the rejected request
    assert_eq!(state.edge.in_flight.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn load_shed_health_routes_are_exempt() {
    let config = AppConfig::from_lookup(|key| match key {
        "RATE_MAX_IN_FLIGHT" => Some("1".to_string()),
        _ => None,
    });
    let state = AppState::from_config(&config);

    // Overload the server
    state.edge.in_flight.store(100, Ordering::SeqCst);

    // Health route must remain reachable for orchestrators
    let health = send(&state, Method::GET, "/api/health").await;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.json["overall_status"], "HEALTHY");

    // Product route is shed
    let product = send(&state, Method::GET, "/api/v1/vote/countries").await;
    assert_eq!(product.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(product.json["code"], "server.unavailable");
}

#[tokio::test]
async fn load_shed_recovers_when_in_flight_drops() {
    let config = AppConfig::from_lookup(|key| match key {
        "RATE_MAX_IN_FLIGHT" => Some("1".to_string()),
        _ => None,
    });
    let state = AppState::from_config(&config);

    state.edge.in_flight.store(1, Ordering::SeqCst);
    let shed = send(&state, Method::GET, "/api/v1/vote/countries").await;
    assert_eq!(shed.status, StatusCode::SERVICE_UNAVAILABLE);

    // In-flight count drops below ceiling
    state.edge.in_flight.store(0, Ordering::SeqCst);
    let recovered = send(&state, Method::GET, "/api/v1/vote/countries").await;
    assert_eq!(recovered.status, StatusCode::OK);
}
