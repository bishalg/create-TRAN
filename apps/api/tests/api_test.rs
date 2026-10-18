use api::build_app;
use api::state::AppState;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_health_endpoint() {
    let app = build_app(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["overall_status"], "HEALTHY");
    assert!(json["components"].as_array().unwrap().len() >= 4);
}

#[tokio::test]
async fn test_tran_info_endpoint() {
    let app = build_app(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/tran/info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["stack"], "TRAN");
    assert_eq!(
        json["layers"]["T"],
        "TanStack Start (Web App with SSR, Router, Streaming)"
    );
    assert_eq!(
        json["layers"]["R"],
        "Rust Core (Shared logic, Domain, Validation, Algorithms)"
    );
    assert_eq!(
        json["layers"]["A"],
        "Axum (High-performance Async Web Backend)"
    );
    assert_eq!(
        json["layers"]["N"],
        "Native (React Native / Expo iOS & Android Mobile)"
    );
}

#[tokio::test]
async fn test_compute_endpoint_valid() {
    let app = build_app(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/tran/compute")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"a": 15.0, "b": 3.0, "operation": "multiply"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["result"], 45.0);
}

#[tokio::test]
async fn test_compute_endpoint_divide_by_zero() {
    let app = build_app(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/tran/compute")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"a": 10.0, "b": 0.0, "operation": "divide"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["success"], false);
    assert_eq!(json["error"], "Division by zero is not allowed");
}
