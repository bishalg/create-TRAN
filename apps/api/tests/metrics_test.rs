// Verifies: REQ-OBS-005 REQ-OBS-006
//! RED metrics and private Prometheus exposition (spec 023, REQ-OBS-005, REQ-OBS-006).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use api::state::AppState;
use api::{build_app, create_metrics_router};
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn red_metrics_and_bounded_labels() {
    let state = AppState::new();
    let app = build_app(state.clone());

    // 1. Valid request to country list
    let req1 = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/vote/countries")
        .body(Body::empty())
        .unwrap();
    let res1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::OK);

    // 2. Valid request to country with code param
    let req2 = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/vote/countries/NP")
        .body(Body::empty())
        .unwrap();
    let res2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::OK);

    // 3. Failing request to eligibility
    let req3 = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/vote/eligibility")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{ bad json }"))
        .unwrap();
    let res3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(res3.status(), StatusCode::BAD_REQUEST);

    // 4. Unmatched route
    let req4 = Request::builder()
        .method(Method::GET)
        .uri("/api/v1/unknown-endpoint-for-metrics")
        .body(Body::empty())
        .unwrap();
    let res4 = app.clone().oneshot(req4).await.unwrap();
    assert_eq!(res4.status(), StatusCode::NOT_FOUND);

    let rendered = state.render_metrics();

    // tran_build_info{version} = 1
    assert!(
        rendered.contains("tran_build_info"),
        "metrics must contain tran_build_info: {rendered}"
    );

    // tran_http_requests_total counters
    assert!(
        rendered.contains(
            r#"tran_http_requests_total{method="GET",route="/api/v1/vote/countries",status="200"}"#
        ),
        "missing total counter for /vote/countries: {rendered}"
    );
    assert!(
        rendered.contains(r#"tran_http_requests_total{method="GET",route="/api/v1/vote/countries/{code}",status="200"}"#),
        "missing template counter for /vote/countries/{{code}}: {rendered}"
    );
    assert!(
        rendered.contains(r#"tran_http_requests_total{method="POST",route="/api/v1/vote/eligibility",status="400"}"#),
        "missing counter for 400 status: {rendered}"
    );
    assert!(
        rendered
            .contains(r#"tran_http_requests_total{method="GET",route="unmatched",status="404"}"#),
        "missing counter for unmatched route: {rendered}"
    );

    // Verify bounded labels: param "NP" must NOT appear in labels
    assert!(
        !rendered.contains(r#"route="/api/v1/vote/countries/NP""#),
        "raw path param NP must not be in metric labels: {rendered}"
    );

    // Duration histogram buckets
    assert!(
        rendered.contains(r#"tran_http_request_duration_seconds_bucket"#),
        "missing duration histogram: {rendered}"
    );
    for bucket in [
        "0.005", "0.01", "0.025", "0.05", "0.1", "0.25", "0.5", "1", "2.5", "5", "10",
    ] {
        assert!(
            rendered.contains(&format!(r#"le="{bucket}""#)),
            "missing bucket {bucket} in duration histogram: {rendered}"
        );
    }

    // In-flight requests gauge
    assert!(
        rendered.contains("tran_http_requests_in_flight"),
        "missing in flight requests gauge: {rendered}"
    );
}

#[tokio::test]
async fn public_router_has_no_metrics() {
    let app = build_app(AppState::new());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/metrics")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "public router MUST NOT serve /metrics"
    );
}

#[tokio::test]
async fn metrics_listener_serves_prometheus_format() {
    let state = AppState::new();
    let metrics_router = create_metrics_router(state);

    let req = Request::builder()
        .method(Method::GET)
        .uri("/metrics")
        .body(Body::empty())
        .unwrap();

    let res = metrics_router.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let content_type = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    assert!(
        content_type.contains("text/plain"),
        "metrics must be served with text/plain: {content_type}"
    );

    let body = res.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(
        text.contains("tran_build_info"),
        "metrics response must contain tran_build_info: {text}"
    );
}

// Verifies: REQ-OBS-005
#[tokio::test]
async fn build_info_names_the_version_and_the_commit() {
    let rendered = AppState::new().render_metrics();
    let expected = format!(
        r#"tran_build_info{{version="{}",commit="{}"}} 1"#,
        api::metrics::BUILD_VERSION,
        api::metrics::BUILD_COMMIT
    );
    assert!(rendered.contains(&expected), "{rendered}");
    assert_eq!(api::metrics::BUILD_VERSION, env!("CARGO_PKG_VERSION"));
    assert_eq!(
        api::metrics::BUILD_COMMIT,
        option_env!("TRAN_COMMIT").unwrap_or("unknown")
    );
}

// Verifies: REQ-RL-008 REQ-OBS-006
#[tokio::test]
async fn metrics_listener_counts_limited_requests_by_class() {
    let state = AppState::from_config(&api::config::AppConfig::from_lookup(|key| {
        (key == "RATE_LIMIT_WRITE").then(|| "60/1".to_string())
    }));
    let app = build_app(state.clone());
    let scrape = || async {
        let res = create_metrics_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = res.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8(body.to_vec()).unwrap();
        text.lines()
            .find_map(|line| line.strip_prefix(r#"tran_rate_limited_total{class="write"} "#))
            .map_or(0, |value| value.trim().parse::<u64>().unwrap())
    };
    let before = scrape().await;
    for _ in 0..3 {
        let req = Request::builder()
            .method(Method::DELETE)
            .uri("/api/v1/devices/00000000-0000-0000-0000-000000000000")
            .body(Body::empty())
            .unwrap();
        app.clone().oneshot(req).await.unwrap();
    }
    // One allowed, two limited.
    assert_eq!(scrape().await, before + 2);
}
