// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-005 REQ-VER-006 REQ-VER-007
//! API versioning against the real layer stack (spec 028): the versioned base path, the client
//! header in the access log, the `426` below the minimum, the nudge below the recommended version
//! and the deprecation notice on a test-only route table.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::Arc;

use api::client_versions::{ClientThresholds, ClientVersionSettings};
use api::config::AppConfig;
use api::routes::table::{Route, Sunset, Verb, ROUTES};
use api::state::AppState;
use api::{build_app, run_server, with_layers_and_routes, Limits};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::routing::get;
use axum::Router;
use http_body_util::BodyExt;
use serde_json::Value;
use support::Captured;
use tokio::sync::Mutex;
use tower::ServiceExt;
use tracing::Level;

/// The log tests share the request span's call site with every other test here; they take turns
/// so none of them loses an event (docs/LEARNINGS.md, 2026-11-10).
static SERIAL: Mutex<()> = Mutex::const_new(());

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Value,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }
}

async fn send(app: Router, method: Method, path: &str, headers: &[(&str, &str)]) -> Reply {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let body = if path.ends_with("/eligibility") {
        Body::from(r#"{"age": 20}"#)
    } else {
        Body::empty()
    };
    let response = app
        .oneshot(
            builder
                .header("content-type", "application/json")
                .body(body)
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

/// The app with `pairs` as its environment.
fn app_with(pairs: &[(&str, &str)]) -> Router {
    let pairs: Vec<(String, String)> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let config =
        AppConfig::from_lookup(|key| pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone()));
    build_app(AppState::from_config(&config))
}

const THRESHOLDS: [(&str, &str); 4] = [
    ("CLIENT_MIN_VERSION_IOS", "1.2.0"),
    ("CLIENT_RECOMMENDED_VERSION_IOS", "1.5.0"),
    ("CLIENT_MIN_VERSION_WEB", "2.0.0"),
    ("CLIENT_RECOMMENDED_VERSION_ANDROID", "3.0"),
];

// ── REQ-VER-001: one versioned base path ─────────────────────────────────────────────────────

#[tokio::test]
async fn every_product_route_is_served_under_the_base_path_and_health_is_not() {
    let _turn = SERIAL.lock().await;
    let app = app_with(&[]);
    for route in &ROUTES {
        let path = route
            .template()
            .replace("{code}", "NP")
            .replace("{installation_id}", "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c");
        let method = Method::from_bytes(route.verb.as_str().as_bytes()).unwrap();
        let reply = send(app.clone(), method, &path, &[]).await;
        let code = reply.body["code"].as_str().unwrap_or_default();
        assert!(
            !["route.not_found", "route.method_not_allowed"].contains(&code),
            "{route:?} is not routed: {}",
            reply.status
        );
        assert!(path.starts_with("/api/v1/"), "{path}");
    }
    let health = send(app, Method::GET, "/api/health", &[]).await;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.body["overall_status"], "HEALTHY");
}

#[tokio::test]
async fn old_paths_and_unknown_versions_answer_404_in_the_envelope() {
    let _turn = SERIAL.lock().await;
    let app = app_with(&[]);
    for path in [
        "/api/vote/countries",
        "/api/tran/info",
        "/api/auth/session",
        "/api/v9/vote/countries",
        "/api/v2/tran/info",
        "/api/v1/health",
    ] {
        let reply = send(app.clone(), Method::GET, path, &[]).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(reply.body["code"], "route.not_found", "{path}");
        assert_eq!(reply.body["success"], false, "{path}");
    }
}

// ── REQ-VER-004: every client says who it is ─────────────────────────────────────────────────

#[tokio::test]
async fn the_access_log_names_the_client_by_its_parsed_header() {
    let _turn = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = app_with(&[]);
    let cases = [
        (Some("ios/1.4.0"), "ios", "1.4.0"),
        (Some("web/2.0.0-beta.1"), "web", "2.0.0-beta.1"),
        (Some("android/1.4.0 attacker=1"), "unknown", "-"),
        (
            Some("web/1.0.0-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            "unknown",
            "-",
        ),
        (None, "unknown", "-"),
    ];
    for (header, platform, version) in cases {
        let headers: Vec<(&str, &str)> = header.map(|h| ("x-tran-client", h)).into_iter().collect();
        let reply = send(app.clone(), Method::GET, "/api/v1/tran/info", &headers).await;
        assert_eq!(reply.status, StatusCode::OK, "{header:?}");
        let id = reply.header("x-request-id").unwrap();
        let completed: Vec<_> = captured
            .named("request completed")
            .into_iter()
            .filter(|e| e.field("request_id") == Some(id))
            .collect();
        assert_eq!(completed.len(), 1, "{header:?}");
        assert_eq!(
            completed[0].field("client_platform"),
            Some(platform),
            "{header:?}"
        );
        assert_eq!(
            completed[0].field("client_version"),
            Some(version),
            "{header:?}"
        );
        assert_eq!(completed[0].field("path"), Some("/api/v1/tran/info"));
    }
    let lines: String = captured.events().iter().map(|e| e.line()).collect();
    assert!(
        !lines.contains("attacker"),
        "only the parsed form is logged"
    );
}

#[tokio::test]
async fn preflight_permits_the_client_header_and_browsers_may_read_the_nudge() {
    let _turn = SERIAL.lock().await;
    let reply = send(
        app_with(&[]),
        Method::OPTIONS,
        "/api/v1/vote/eligibility",
        &[
            ("origin", "http://127.0.0.1:3000"),
            ("access-control-request-method", "POST"),
            (
                "access-control-request-headers",
                "content-type,x-tran-client",
            ),
        ],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    let allowed = reply.header("access-control-allow-headers").unwrap();
    assert!(allowed.contains("x-tran-client"), "{allowed}");

    let simple = send(
        app_with(&[]),
        Method::GET,
        "/api/v1/tran/info",
        &[("origin", "http://127.0.0.1:3000")],
    )
    .await;
    let exposed = simple.header("access-control-expose-headers").unwrap();
    for name in [
        "x-tran-update",
        "x-tran-recommended-version",
        "deprecation",
        "sunset",
    ] {
        assert!(exposed.contains(name), "{name} in {exposed}");
    }
}

// ── REQ-VER-005: below the minimum, 426 before any handler ───────────────────────────────────

#[tokio::test]
async fn a_client_below_its_minimum_gets_426_on_every_product_route() {
    let _turn = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let app = app_with(&THRESHOLDS);
    for route in &ROUTES {
        let path = route
            .template()
            .replace("{code}", "NP")
            .replace("{installation_id}", "not-even-a-uuid");
        let method = Method::from_bytes(route.verb.as_str().as_bytes()).unwrap();
        let reply = send(
            app.clone(),
            method,
            &path,
            &[("x-tran-client", "ios/1.1.9")],
        )
        .await;
        assert_eq!(reply.status, StatusCode::UPGRADE_REQUIRED, "{route:?}");
        assert_eq!(reply.body["code"], "client.upgrade_required", "{route:?}");
        assert_eq!(reply.body["retryable"], false);
        assert_eq!(reply.body["success"], false);
        assert!(reply.header("x-tran-update").is_none());
    }
    let failures = captured.named("request failed");
    assert_eq!(failures.len(), ROUTES.len());
    assert!(failures.iter().all(|e| e.level == Level::INFO
        && e.field("code") == Some("client.upgrade_required")
        && e.field("status") == Some("426")
        && e.field("client_version") == Some("1.1.9")));
}

#[tokio::test]
async fn health_unknown_clients_and_other_platforms_are_served() {
    let _turn = SERIAL.lock().await;
    let app = app_with(&THRESHOLDS);
    let health = send(
        app.clone(),
        Method::GET,
        "/api/health",
        &[("x-tran-client", "ios/0.0.1")],
    )
    .await;
    assert_eq!(health.status, StatusCode::OK, "health is exempt");
    assert!(health.header("x-tran-update").is_none());
    for header in [
        None,
        Some("ios/latest"),
        Some("watch/0.1.0"),
        Some("android/0.1.0"),
    ] {
        let headers: Vec<(&str, &str)> = header.map(|h| ("x-tran-client", h)).into_iter().collect();
        let reply = send(app.clone(), Method::GET, "/api/v1/vote/countries", &headers).await;
        assert_eq!(reply.status, StatusCode::OK, "{header:?}");
    }
    let at_minimum = send(
        app.clone(),
        Method::POST,
        "/api/v1/vote/eligibility",
        &[("x-tran-client", "ios/1.2.0")],
    )
    .await;
    assert_eq!(at_minimum.status, StatusCode::OK);
    let unknown_version = send(
        app,
        Method::GET,
        "/api/v9/tran/info",
        &[("x-tran-client", "ios/0.1.0")],
    )
    .await;
    assert_eq!(
        unknown_version.status,
        StatusCode::NOT_FOUND,
        "only product routes meet the 426"
    );
}

#[tokio::test]
async fn a_malformed_threshold_stops_start_up_naming_the_variable() {
    let config = AppConfig::from_lookup(|key| {
        (key == "CLIENT_RECOMMENDED_VERSION_WEB").then(|| "soon".to_string())
    });
    let err = run_server(config).await.unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert_eq!(
        err.to_string(),
        "CLIENT_RECOMMENDED_VERSION_WEB is not a version (for example 1.4.0)"
    );
    let settings = ClientVersionSettings::default();
    assert_eq!(
        ClientThresholds::from_settings(&settings).unwrap(),
        ClientThresholds::default()
    );
}

// ── REQ-VER-006: below the recommended version, a nudge ──────────────────────────────────────

#[tokio::test]
async fn a_client_below_its_recommended_version_is_nudged_and_served() {
    let _turn = SERIAL.lock().await;
    let app = app_with(&THRESHOLDS);
    let plain = send(app.clone(), Method::POST, "/api/v1/vote/eligibility", &[]).await;
    for (header, nudged, recommended) in [
        ("ios/1.4.9", true, Some("1.5.0")),
        ("ios/1.2.0", true, Some("1.5.0")),
        ("android/2.9.9", true, Some("3.0")),
        ("ios/1.5.0", false, None),
        ("ios/2.0.0", false, None),
        ("android/3.0.0", false, None),
        ("web/2.0.0", false, None),
    ] {
        let reply = send(
            app.clone(),
            Method::POST,
            "/api/v1/vote/eligibility",
            &[("x-tran-client", header)],
        )
        .await;
        assert_eq!(reply.status, StatusCode::OK, "{header}");
        assert_eq!(
            reply.header("x-tran-update"),
            nudged.then_some("recommended"),
            "{header}"
        );
        assert_eq!(
            reply.header("x-tran-recommended-version"),
            recommended,
            "{header}"
        );
        assert_eq!(
            reply.body["eligible"], plain.body["eligible"],
            "nothing else changes"
        );
    }
    let health = send(
        app,
        Method::GET,
        "/api/health",
        &[("x-tran-client", "ios/1.4.9")],
    )
    .await;
    assert!(health.header("x-tran-update").is_none());
}

// ── REQ-VER-007: deprecation is announced before removal ─────────────────────────────────────

static DEPRECATED_TABLE: [Route; 2] = [
    Route {
        verb: Verb::Get,
        path: "/old",
        deprecated: Some(Sunset {
            deprecated_at: 1_798_675_200,
            sunset_at: 1_814_400_000,
        }),
        handler: || get(|| async { "old" }),
    },
    Route {
        verb: Verb::Get,
        path: "/new",
        deprecated: None,
        handler: || get(|| async { "new" }),
    },
];

fn deprecated_app() -> Router {
    let state = AppState::new();
    let edge = state.edge.clone();
    let router = DEPRECATED_TABLE
        .iter()
        .fold(Router::new(), |router, route| {
            router.route(&route.template(), (route.handler)())
        })
        .with_state(state);
    with_layers_and_routes(router, Limits::default(), &edge, &DEPRECATED_TABLE)
}

#[tokio::test]
async fn a_deprecated_route_announces_its_sunset_and_logs_who_called() {
    let _turn = SERIAL.lock().await;
    let (captured, _guard) = Captured::install();
    let reply = send(
        deprecated_app(),
        Method::GET,
        "/api/v1/old",
        &[("x-tran-client", "android/1.3.0")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header("deprecation"), Some("@1798675200"));
    assert_eq!(
        reply.header("sunset"),
        Some("Thu, 01 Jul 2027 00:00:00 GMT")
    );

    let events = captured.named("deprecated route called");
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].level, Level::INFO);
    assert_eq!(events[0].field("route"), Some("/api/v1/old"));
    assert_eq!(events[0].field("client_platform"), Some("android"));
    assert_eq!(events[0].field("client_version"), Some("1.3.0"));
    assert_eq!(
        events[0].field("request_id"),
        reply.header("x-request-id"),
        "inside the request span"
    );

    let current = send(deprecated_app(), Method::GET, "/api/v1/new", &[]).await;
    assert_eq!(current.status, StatusCode::OK);
    assert!(current.header("deprecation").is_none());
    assert!(current.header("sunset").is_none());
    let anonymous = send(deprecated_app(), Method::GET, "/api/v1/old", &[]).await;
    assert_eq!(anonymous.header("deprecation"), Some("@1798675200"));
    let events = captured.named("deprecated route called");
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].field("client_version"), Some("-"));
}

#[tokio::test]
async fn the_thresholds_live_on_the_edge() {
    let state = AppState::from_config(&AppConfig::from_lookup(|key| {
        (key == "CLIENT_MIN_VERSION_IOS").then(|| "1.0.0".to_string())
    }));
    assert_ne!(
        state.edge.client_thresholds,
        Arc::new(ClientThresholds::default())
    );
    let malformed = AppState::from_config(&AppConfig::from_lookup(|key| {
        (key == "CLIENT_MIN_VERSION_IOS").then(|| "one".to_string())
    }));
    assert_eq!(
        malformed.edge.client_thresholds,
        Arc::new(ClientThresholds::default())
    );
}
