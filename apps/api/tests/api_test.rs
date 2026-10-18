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
    assert_eq!(json["demo"], "voting-eligibility");
}

#[tokio::test]
async fn test_vote_eligibility_eligible() {
    let app = build_app(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/vote/eligibility")
                .header("content-type", "application/json")
                .header("x-debug-country", "US")
                .body(Body::from(r#"{"age": 21}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["eligible"], true);
    assert_eq!(json["minimum_age"], 18);
    assert_eq!(json["country_code"], "US");
}

#[tokio::test]
async fn test_vote_eligibility_too_young() {
    let app = build_app(AppState::new());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/vote/eligibility")
                .header("content-type", "application/json")
                .header("x-debug-country", "IN")
                .body(Body::from(r#"{"age": 16}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["eligible"], false);
    assert_eq!(json["country_code"], "IN");
}
