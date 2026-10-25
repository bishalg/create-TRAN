// Verifies: REQ-API-001 REQ-API-002 REQ-API-003 REQ-API-004 REQ-API-005 REQ-API-006 REQ-API-008 REQ-API-009 REQ-API-010 REQ-API-012 REQ-ERR-002
//! HTTP-level integration tests. Each test drives the real router in-process (no socket),
//! so they are fast and deterministic. Naming: `<endpoint>_<condition>_<outcome>`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

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
    json: Value,
    request_id: Option<String>,
}

async fn send(request: Request<Body>) -> Reply {
    send_to(AppState::new(), request).await
}

async fn send_to(state: AppState, request: Request<Body>) -> Reply {
    let response = build_app(state).oneshot(request).await.unwrap();
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-request-id")
        .map(|v| v.to_str().unwrap().to_string());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Reply {
        status,
        json,
        request_id,
    }
}

fn get(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

/// POST /api/vote/eligibility with optional extra headers.
fn eligibility(body: &str, headers: &[(&str, &str)]) -> Request<Body> {
    let mut builder = Request::builder()
        .method(Method::POST)
        .uri("/api/vote/eligibility")
        .header(header::CONTENT_TYPE, "application/json");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    builder.body(Body::from(body.to_string())).unwrap()
}

/// REQ-ERR-002: status, catalogue code, retryability and a request id that matches the header.
fn assert_error_envelope(reply: &Reply, status: StatusCode, code: &str, needle: &str) {
    assert_eq!(reply.status, status, "body: {}", reply.json);
    assert_eq!(reply.json["success"], false, "body: {}", reply.json);
    assert_eq!(reply.json["code"], code, "body: {}", reply.json);
    assert_eq!(reply.json["retryable"], false, "body: {}", reply.json);
    let request_id = reply.json["request_id"].as_str().unwrap_or_default();
    assert!(!request_id.is_empty(), "body: {}", reply.json);
    assert_eq!(reply.request_id.as_deref(), Some(request_id));
    let message = reply.json["error"].as_str().unwrap_or_default();
    assert!(
        message.contains(needle),
        "error {message:?} should contain {needle:?}"
    );
}

/// App state as `run_server` builds it for the given `APP_ENV`.
fn state_for_env(app_env: &str) -> AppState {
    let config = AppConfig::from_lookup(|key| (key == "APP_ENV").then(|| app_env.to_string()));
    AppState::from_config(&config)
}

// ── GET /api/health ────────────────────────────────────────────────────────

#[tokio::test]
async fn health_reports_core_and_api_with_real_versions() {
    let reply = send(get("/api/health")).await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["overall_status"], "HEALTHY");
    let components = reply.json["components"].as_array().unwrap();
    let names: Vec<&str> = components
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["rust-core", "axum-api"]);
    assert_eq!(components[1]["version"], env!("CARGO_PKG_VERSION"));
}

// ── GET /api/tran/info ─────────────────────────────────────────────────────

#[tokio::test]
async fn info_identifies_the_stack_and_demo() {
    let reply = send(get("/api/tran/info")).await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["stack"], "TRAN");
    assert_eq!(reply.json["demo"], "voting-eligibility");
}

// ── POST /api/vote/eligibility: happy paths ────────────────────────────────

#[tokio::test]
async fn eligibility_adult_with_debug_country_is_eligible() {
    let reply = send(eligibility(r#"{"age": 21}"#, &[("x-debug-country", "US")])).await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["eligible"], true);
    assert_eq!(reply.json["minimum_age"], 18);
    assert_eq!(reply.json["country_code"], "US");
    assert_eq!(reply.json["country_source"], "x-debug-country");
}

#[tokio::test]
async fn eligibility_minor_is_not_eligible() {
    let reply = send(eligibility(r#"{"age": 16}"#, &[("x-debug-country", "IN")])).await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["eligible"], false);
    assert_eq!(reply.json["country_code"], "IN");
}

#[tokio::test]
async fn eligibility_exactly_minimum_age_is_eligible() {
    let reply = send(eligibility(r#"{"age": 16}"#, &[("x-debug-country", "BR")])).await;

    assert_eq!(reply.json["eligible"], true);
    assert_eq!(reply.json["minimum_age"], 16);
}

#[tokio::test]
async fn eligibility_lowercase_debug_country_is_normalised_in_code_and_reason() {
    let reply = send(eligibility(r#"{"age": 30}"#, &[("x-debug-country", "np")])).await;

    assert_eq!(reply.json["country_code"], "NP");
    assert!(reply.json["reason"].as_str().unwrap().ends_with("in NP."));
}

#[tokio::test]
async fn eligibility_birthdate_takes_precedence_over_age() {
    let reply = send(eligibility(
        r#"{"age": 5, "birthdate": "1990-01-01"}"#,
        &[("x-debug-country", "US")],
    ))
    .await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["eligible"], true);
    assert!(reply.json["age"].as_u64().unwrap() >= 35);
}

#[tokio::test]
async fn eligibility_response_carries_a_uuid_and_timestamp() {
    let reply = send(eligibility(r#"{"age": 21}"#, &[])).await;

    assert_eq!(reply.json["eligibility_id"].as_str().unwrap().len(), 36);
    assert!(reply.json["evaluated_at"].as_str().unwrap().contains('T'));
}

// ── POST /api/vote/eligibility: client IP + geo resolution ─────────────────

#[tokio::test]
async fn eligibility_without_headers_defaults_to_loopback_us() {
    let reply = send(eligibility(r#"{"age": 21}"#, &[])).await;

    assert_eq!(reply.json["client_ip"], "127.0.0.1");
    assert_eq!(reply.json["country_code"], "US");
    assert_eq!(reply.json["country_source"], "loopback-default");
}

#[tokio::test]
async fn eligibility_uses_first_hop_of_x_forwarded_for() {
    let reply = send(eligibility(
        r#"{"age": 21}"#,
        &[("x-forwarded-for", "192.168.1.9, 8.8.8.8")],
    ))
    .await;

    assert_eq!(reply.json["client_ip"], "192.168.1.9");
    assert_eq!(reply.json["country_code"], "IN");
    assert_eq!(reply.json["country_source"], "private-range-stub");
}

#[tokio::test]
async fn eligibility_falls_back_to_x_real_ip() {
    let reply = send(eligibility(r#"{"age": 21}"#, &[("x-real-ip", "8.8.4.4")])).await;

    assert_eq!(reply.json["client_ip"], "8.8.4.4");
    assert_eq!(reply.json["country_source"], "default");
}

#[tokio::test]
async fn eligibility_debug_country_beats_ip_based_resolution() {
    let reply = send(eligibility(
        r#"{"age": 21}"#,
        &[("x-forwarded-for", "10.0.0.5"), ("x-debug-country", "BR")],
    ))
    .await;

    assert_eq!(reply.json["country_code"], "BR");
    assert_eq!(reply.json["country_source"], "x-debug-country");
}

#[tokio::test]
async fn eligibility_debug_country_is_ignored_in_production() {
    let reply = send_to(
        state_for_env("production"),
        eligibility(r#"{"age": 16}"#, &[("x-debug-country", "BR")]),
    )
    .await;

    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.json["country_code"], "US");
    assert_eq!(reply.json["country_source"], "loopback-default");
}

#[tokio::test]
async fn eligibility_debug_country_is_honoured_in_test_env() {
    let reply = send_to(
        state_for_env("test"),
        eligibility(r#"{"age": 16}"#, &[("x-debug-country", "BR")]),
    )
    .await;

    assert_eq!(reply.json["country_source"], "x-debug-country");
}

// ── POST /api/vote/eligibility: rejected input (uniform error envelope) ────

#[tokio::test]
async fn eligibility_age_above_maximum_is_a_400_with_envelope() {
    let reply = send(eligibility(r#"{"age": 151}"#, &[])).await;

    assert_error_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation.age_out_of_range",
        "Age must be 150 or less",
    );
}

#[tokio::test]
async fn eligibility_maximum_age_is_accepted() {
    let reply = send(eligibility(r#"{"age": 150}"#, &[])).await;

    assert_eq!(reply.status, StatusCode::OK);
}

#[tokio::test]
async fn eligibility_future_birthdate_is_a_400() {
    let reply = send(eligibility(r#"{"age": 1, "birthdate": "2999-01-01"}"#, &[])).await;

    assert_error_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation.birthdate_in_future",
        "future",
    );
}

#[tokio::test]
async fn eligibility_malformed_debug_country_is_a_400() {
    let reply = send(eligibility(r#"{"age": 21}"#, &[("x-debug-country", "USA")])).await;

    assert_error_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation.invalid_country_code",
        "Country code",
    );
}

#[tokio::test]
async fn eligibility_malformed_json_is_a_400_with_envelope() {
    let reply = send(eligibility(r#"{"age": "#, &[])).await;

    assert_error_envelope(&reply, StatusCode::BAD_REQUEST, "request.malformed", "");
}

#[tokio::test]
async fn eligibility_missing_age_is_a_400_with_envelope() {
    let reply = send(eligibility(r#"{}"#, &[])).await;

    assert_error_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "request.malformed",
        "expected shape",
    );
}

#[tokio::test]
async fn eligibility_negative_age_is_a_400_with_envelope() {
    let reply = send(eligibility(r#"{"age": -1}"#, &[])).await;

    assert_error_envelope(&reply, StatusCode::BAD_REQUEST, "request.malformed", "");
}

#[tokio::test]
async fn eligibility_impossible_calendar_date_is_a_400_with_envelope() {
    let reply = send(eligibility(
        r#"{"age": 20, "birthdate": "2000-02-30"}"#,
        &[],
    ))
    .await;

    assert_error_envelope(&reply, StatusCode::BAD_REQUEST, "request.malformed", "");
}

#[tokio::test]
async fn eligibility_without_json_content_type_is_a_415_with_envelope() {
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/vote/eligibility")
        .body(Body::from(r#"{"age": 21}"#))
        .unwrap();
    let reply = send(request).await;

    assert_error_envelope(
        &reply,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "request.unsupported_media_type",
        "",
    );
}

// ── Routing ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn unknown_route_is_404_with_envelope() {
    let reply = send(get("/api/nope")).await;

    assert_error_envelope(&reply, StatusCode::NOT_FOUND, "route.not_found", "No route");
}

#[tokio::test]
async fn eligibility_rejects_get_with_405_envelope() {
    let reply = send(get("/api/vote/eligibility")).await;

    assert_error_envelope(
        &reply,
        StatusCode::METHOD_NOT_ALLOWED,
        "route.method_not_allowed",
        "method",
    );
}

// ── Request ids ────────────────────────────────────────────────────────────

#[tokio::test]
async fn request_id_is_minted_for_successful_responses_too() {
    let reply = send(get("/api/health")).await;

    let id = reply.request_id.expect("x-request-id header");
    assert!(uuid::Uuid::parse_str(&id).is_ok(), "{id}");
}

#[tokio::test]
async fn request_id_reuses_a_well_formed_incoming_id() {
    let reply = send(eligibility(
        r#"{"age": 151}"#,
        &[("x-request-id", "trace-42")],
    ))
    .await;

    assert_eq!(reply.request_id.as_deref(), Some("trace-42"));
    assert_eq!(reply.json["request_id"], "trace-42");
}

#[tokio::test]
async fn request_id_replaces_an_unsafe_incoming_id() {
    let reply = send(eligibility(
        r#"{"age": 21}"#,
        &[("x-request-id", "has spaces and is not safe")],
    ))
    .await;

    let id = reply.request_id.expect("x-request-id header");
    assert_ne!(id, "has spaces and is not safe");
}

// ── CORS ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn cors_preflight_allows_the_debug_country_header() {
    let request = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/vote/eligibility")
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            "content-type,x-debug-country",
        )
        .body(Body::empty())
        .unwrap();
    let response = build_app(AppState::new()).oneshot(request).await.unwrap();

    assert!(response.status().is_success());
    let allowed = response
        .headers()
        .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
        .map(|v| v.to_str().unwrap().to_lowercase())
        .unwrap_or_default();
    assert!(
        allowed.contains("x-debug-country") || allowed == "*",
        "allow-headers was {allowed:?}"
    );
}

// ── Countries (REQ-API-009, REQ-API-010) ────────────────────────────────────

#[tokio::test]
async fn countries_list_returns_sorted_supported_countries() {
    let reply = send(get("/api/vote/countries")).await;

    assert_eq!(reply.status, StatusCode::OK);
    let list = reply.json["countries"].as_array().expect("countries array");
    assert_eq!(list.len(), rust_core::SUPPORTED_COUNTRIES.len());

    for (i, expected) in rust_core::SUPPORTED_COUNTRIES.iter().enumerate() {
        assert_eq!(list[i]["country_code"], expected.country_code);
        assert_eq!(list[i]["minimum_age"], expected.minimum_age);
    }
}

#[tokio::test]
async fn countries_single_returns_country_for_supported_code_case_insensitive() {
    let reply_lower = send(get("/api/vote/countries/br")).await;
    assert_eq!(reply_lower.status, StatusCode::OK);
    assert_eq!(reply_lower.json["country_code"], "BR");
    assert_eq!(reply_lower.json["minimum_age"], 16);

    let reply_upper = send(get("/api/vote/countries/BR")).await;
    assert_eq!(reply_upper.status, StatusCode::OK);
    assert_eq!(reply_upper.json["country_code"], "BR");
    assert_eq!(reply_upper.json["minimum_age"], 16);
}

#[tokio::test]
async fn countries_single_returns_400_for_malformed_code() {
    let reply = send(get("/api/vote/countries/USA")).await;
    assert_error_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation.invalid_country_code",
        "two ASCII letters",
    );

    let reply_digit = send(get("/api/vote/countries/12")).await;
    assert_error_envelope(
        &reply_digit,
        StatusCode::BAD_REQUEST,
        "validation.invalid_country_code",
        "two ASCII letters",
    );
}

#[tokio::test]
async fn countries_single_returns_404_for_unsupported_well_formed_code() {
    let reply = send(get("/api/vote/countries/XX")).await;
    assert_error_envelope(
        &reply,
        StatusCode::NOT_FOUND,
        "route.not_found",
        "Country not supported",
    );
}
