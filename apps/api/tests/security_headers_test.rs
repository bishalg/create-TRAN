// Verifies: REQ-SEC-013
//! Every response carries the security headers, success or failure, preflight included; HSTS only
//! where HTTPS is required; auth answers are never cached.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use api::build_app;
use api::config::AppConfig;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request};
use tower::ServiceExt;

const ALWAYS: [(&str, &str); 4] = [
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", "no-referrer"),
    ("x-frame-options", "DENY"),
    (
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'",
    ),
];

fn state_for_env(app_env: &str) -> AppState {
    let config = AppConfig::from_lookup(|key| (key == "APP_ENV").then(|| app_env.to_string()));
    AppState::from_config(&config)
}

async fn headers(state: AppState, method: Method, uri: &str, body: &str) -> HeaderMap {
    let request = Request::builder()
        .method(method.clone())
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .body(Body::from(body.to_string()))
        .unwrap();
    build_app(state)
        .oneshot(request)
        .await
        .unwrap()
        .headers()
        .clone()
}

/// Success, an envelope failure, an unknown route, an auth refusal and a CORS preflight.
fn every_kind_of_response() -> [(Method, &'static str, &'static str); 5] {
    [
        (Method::GET, "/api/health", ""),
        (Method::POST, "/api/vote/eligibility", "{\"age\": "),
        (Method::GET, "/api/nope", ""),
        (Method::GET, "/api/auth/session", ""),
        (Method::OPTIONS, "/api/vote/eligibility", ""),
    ]
}

#[tokio::test]
async fn every_response_carries_the_security_headers() {
    for env in ["development", "test", "production"] {
        for (method, uri, body) in every_kind_of_response() {
            let got = headers(state_for_env(env), method.clone(), uri, body).await;
            for (name, value) in ALWAYS {
                assert_eq!(
                    got.get(name).map(|v| v.to_str().unwrap()),
                    Some(value),
                    "{env} {method} {uri}: {name}"
                );
            }
        }
    }
}

#[tokio::test]
async fn hsts_is_sent_only_where_https_is_required() {
    for (env, expected) in [
        ("development", None),
        ("test", None),
        ("staging", Some("max-age=63072000; includeSubDomains")),
        ("production", Some("max-age=63072000; includeSubDomains")),
    ] {
        for (method, uri, body) in every_kind_of_response() {
            let got = headers(state_for_env(env), method.clone(), uri, body).await;
            assert_eq!(
                got.get(header::STRICT_TRANSPORT_SECURITY)
                    .map(|v| v.to_str().unwrap()),
                expected,
                "{env} {method} {uri}"
            );
        }
    }
}

#[tokio::test]
async fn auth_responses_are_never_cached() {
    let auth = [
        (
            Method::POST,
            "/api/auth/session",
            r#"{"role": "citizen_voter", "transport": "body"}"#,
        ),
        (Method::POST, "/api/auth/session", "{}"),
        (Method::GET, "/api/auth/session", ""),
        (Method::POST, "/api/auth/refresh", ""),
        (Method::POST, "/api/auth/sign-out", ""),
        (Method::GET, "/api/auth/unknown", ""),
    ];
    for (method, uri, body) in auth {
        let got = headers(AppState::new(), method.clone(), uri, body).await;
        assert_eq!(
            got.get(header::CACHE_CONTROL).map(|v| v.to_str().unwrap()),
            Some("no-store"),
            "{method} {uri} {body}"
        );
    }
    let health = headers(AppState::new(), Method::GET, "/api/health", "").await;
    assert!(health.get(header::CACHE_CONTROL).is_none());
}
