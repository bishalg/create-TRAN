// Verifies: REQ-ACC-001 REQ-ACC-002 REQ-ACC-003
//! `DELETE /api/v1/account` against the real router, the SQL stores on an in-memory database and a
//! manual clock. Naming follows the spec's "Verified by" lines: `deletion_*`, `foreign_origin_*`,
//! `a_failing_eraser_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use api::account::AccountEraser;
use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::Database;
use api::error::ApiError;
use api::session_store::SessionUser;
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use chrono::{DateTime, Duration, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use support::Captured;
use tower::ServiceExt;
use tracing::Level;

const LOCAL_ORIGIN: &str = "http://localhost:3000";
const FOREIGN_ORIGIN: &str = "https://evil.example";
const DELETED: &str = "account deleted";

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    json: Value,
}

impl Reply {
    fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    fn str(&self, field: &str) -> &str {
        self.json[field].as_str().unwrap_or_default()
    }

    /// The refresh token, from the body or the cookie, whichever the transport used.
    fn refresh(&self) -> String {
        match self.json.get("refresh_token") {
            Some(token) => token.as_str().unwrap().to_string(),
            None => {
                let cookie = self.header(header::SET_COOKIE).unwrap();
                let value = cookie.strip_prefix("tran_refresh=").unwrap();
                value.split(';').next().unwrap().to_string()
            }
        }
    }
}

/// One signed-in session: what a device holds.
struct Device {
    access: String,
    refresh: String,
    cookie: bool,
}

/// The audit test shares the `account deleted` call site with every other test here; they take
/// turns so it never loses its event (docs/LEARNINGS.md, 2026-11-10).
static SERIAL: Mutex<()> = Mutex::new(());

struct Api {
    state: AppState,
    clock: Arc<ManualClock>,
    _serial: MutexGuard<'static, ()>,
}

impl Api {
    fn new() -> Self {
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let clock = Arc::new(ManualClock::starting_at(start));
        let state = AppState {
            sessions: Sessions::sql(Database::in_memory(), clock.clone()),
            ..AppState::from_config(&AppConfig::from_lookup(|key| match key {
                "RATE_LIMIT_AUTH" => Some("1000/1000".to_string()),
                _ => None,
            }))
        };
        Self {
            state,
            clock,
            _serial: serial,
        }
    }

    fn with_eraser(eraser: impl AccountEraser + 'static) -> Self {
        let mut api = Self::new();
        api.state.eraser = Arc::new(eraser);
        api
    }

    async fn send(&self, request: Request<Body>) -> Reply {
        let response = build_app(self.state.clone())
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            headers,
            json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        }
    }

    async fn sign_in(&self, role: &str, transport: &str) -> Device {
        let body = json!({ "role": role, "transport": transport }).to_string();
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/auth/session")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap();
        let reply = self.send(request).await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
        Device {
            access: reply.str("access_token").to_string(),
            refresh: reply.refresh(),
            cookie: transport == "cookie",
        }
    }

    /// `DELETE /api/v1/account` with `authorization` and extra headers.
    async fn delete(&self, authorization: Option<&str>, headers: &[(&str, &str)]) -> Reply {
        let mut builder = Request::builder()
            .method(Method::DELETE)
            .uri("/api/v1/account");
        if let Some(value) = authorization {
            builder = builder.header(header::AUTHORIZATION, value);
        }
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        self.send(builder.body(Body::empty()).unwrap()).await
    }

    async fn delete_as(&self, device: &Device) -> Reply {
        self.delete(Some(&bearer(&device.access)), &[]).await
    }

    async fn whoami(&self, device: &Device) -> StatusCode {
        let request = Request::builder()
            .uri("/api/v1/auth/session")
            .header(header::AUTHORIZATION, bearer(&device.access))
            .body(Body::empty())
            .unwrap();
        self.send(request).await.status
    }

    /// Presents the device's refresh token on its own transport.
    async fn refresh(&self, device: &Device) -> StatusCode {
        let builder = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/auth/refresh")
            .header(header::CONTENT_TYPE, "application/json");
        let request = if device.cookie {
            builder
                .header(header::COOKIE, format!("tran_refresh={}", device.refresh))
                .body(Body::empty())
        } else {
            builder.body(Body::from(
                json!({ "refresh_token": device.refresh }).to_string(),
            ))
        };
        self.send(request.unwrap()).await.status
    }

    /// The device's access token is still accepted.
    async fn is_live(&self, device: &Device) -> bool {
        self.whoami(device).await == StatusCode::OK
    }

    async fn assert_dead(&self, device: &Device, label: &str) {
        assert_eq!(
            self.whoami(device).await,
            StatusCode::UNAUTHORIZED,
            "{label}: access"
        );
        assert_eq!(
            self.refresh(device).await,
            StatusCode::UNAUTHORIZED,
            "{label}: refresh"
        );
    }
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

fn assert_deleted(reply: &Reply) {
    assert_eq!(reply.status, StatusCode::NO_CONTENT, "{}", reply.json);
    assert_eq!(reply.json, Value::Null, "204 has no body");
    assert_eq!(reply.header(header::CACHE_CONTROL), Some("no-store"));
}

fn assert_session_expired(reply: &Reply, label: &str) {
    assert_eq!(
        reply.status,
        StatusCode::UNAUTHORIZED,
        "{label}: {}",
        reply.json
    );
    assert_eq!(reply.json["code"], "auth.session_expired", "{label}");
    assert_eq!(reply.header(header::WWW_AUTHENTICATE), Some("Bearer"));
    assert_eq!(reply.header(header::CACHE_CONTROL), Some("no-store"));
    assert!(reply.header(header::SET_COOKIE).is_none(), "{label}");
}

// ── Deletion (REQ-ACC-001) ──────────────────────────────────────────────────

#[tokio::test]
async fn deletion_answers_204_and_ends_the_callers_session() {
    let api = Api::new();
    let device = api.sign_in("citizen_voter", "body").await;

    let reply = api.delete_as(&device).await;
    assert_deleted(&reply);
    assert!(
        reply.header(header::SET_COOKIE).is_none(),
        "the body transport has no cookie to clear"
    );
    api.assert_dead(&device, "after deletion").await;
    assert_session_expired(&api.delete_as(&device).await, "deleting twice");
}

#[tokio::test]
async fn deletion_on_the_cookie_transport_clears_the_refresh_cookie() {
    let api = Api::new();
    let device = api.sign_in("citizen_voter", "cookie").await;

    let reply = api.delete_as(&device).await;
    assert_deleted(&reply);
    assert_eq!(
        reply.header(header::SET_COOKIE),
        Some("tran_refresh=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0")
    );
    api.assert_dead(&device, "cookie session").await;
}

#[tokio::test]
async fn deletion_without_a_valid_token_answers_401_and_erases_nothing() {
    let api = Api::new();
    let device = api.sign_in("citizen_voter", "cookie").await;
    let refresh_as_access = bearer(&device.refresh);
    let basic = format!("Basic {}", device.access);

    for (label, authorization) in [
        ("missing header", None),
        ("unknown token", Some("Bearer unknown")),
        ("refresh token as access", Some(refresh_as_access.as_str())),
        ("another scheme", Some(basic.as_str())),
    ] {
        let reply = api.delete(authorization, &[]).await;
        assert_session_expired(&reply, label);
        assert!(api.is_live(&device).await, "{label}: the session survived");
    }

    api.clock.advance(Duration::seconds(900));
    assert_session_expired(&api.delete_as(&device).await, "expired access token");
    assert_eq!(
        api.refresh(&device).await,
        StatusCode::OK,
        "an expired access token erased nothing"
    );
}

#[tokio::test]
async fn deletion_accepts_no_other_method() {
    let api = Api::new();
    let device = api.sign_in("citizen_voter", "body").await;
    for method in [Method::GET, Method::POST, Method::PUT] {
        let request = Request::builder()
            .method(method.clone())
            .uri("/api/v1/account")
            .header(header::AUTHORIZATION, bearer(&device.access))
            .body(Body::empty())
            .unwrap();
        let reply = api.send(request).await;
        assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED, "{method}");
        assert_eq!(reply.json["code"], "route.method_not_allowed", "{method}");
    }
    assert!(api.is_live(&device).await);
}

// ── Every session of the user (REQ-ACC-002) ─────────────────────────────────

#[tokio::test]
async fn deletion_revokes_every_session_of_the_user() {
    let api = Api::new();
    let phone = api.sign_in("citizen_voter", "body").await;
    let browser = api.sign_in("citizen_voter", "cookie").await;
    let rotated = api.sign_in("citizen_voter", "body").await;
    let spent = Device {
        access: rotated.access.clone(),
        refresh: rotated.refresh.clone(),
        cookie: false,
    };
    let refresh = json!({ "refresh_token": rotated.refresh }).to_string();
    let reply = api
        .send(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/auth/refresh")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(refresh))
                .unwrap(),
        )
        .await;
    let tablet = Device {
        access: reply.str("access_token").to_string(),
        refresh: reply.refresh(),
        cookie: false,
    };
    let auditor = api.sign_in("election_auditor", "body").await;
    let auditor_browser = api.sign_in("election_auditor", "cookie").await;

    assert_deleted(&api.delete_as(&browser).await);

    for (label, device) in [
        ("phone", &phone),
        ("browser", &browser),
        ("tablet before its refresh", &spent),
        ("tablet", &tablet),
    ] {
        api.assert_dead(device, label).await;
    }
    for device in [&auditor, &auditor_browser] {
        assert!(api.is_live(device).await, "another user's session survived");
        assert_eq!(api.refresh(device).await, StatusCode::OK);
    }
}

// ── The audit event (REQ-ACC-003) ───────────────────────────────────────────

#[tokio::test]
async fn deletion_is_logged_without_identity() {
    let api = Api::new();
    let device = api.sign_in("citizen_voter", "cookie").await;
    let (captured, _guard) = Captured::install();

    let reply = api.delete_as(&device).await;
    assert_deleted(&reply);

    let events = captured.named(DELETED);
    assert_eq!(events.len(), 1, "{events:?}");
    let event = &events[0];
    assert_eq!(event.level, Level::INFO);
    assert_eq!(
        event.field("request_id"),
        reply.header(api::middleware::request_id::REQUEST_ID_HEADER)
    );
    let fields: Vec<&str> = event.fields.keys().map(String::as_str).collect();
    assert_eq!(
        fields,
        [
            "client_platform",
            "client_version",
            "method",
            "path",
            "request_id"
        ],
        "only the request span's own fields"
    );
    for event in captured.events() {
        let line = event.line();
        for secret in [
            "voter-001",
            "citizen_voter",
            device.access.as_str(),
            device.refresh.as_str(),
        ] {
            assert!(!line.contains(secret), "log leaks {secret}: {line}");
        }
    }
}

#[tokio::test]
async fn deletion_that_fails_logs_no_deletion() {
    let api = Api::new();
    let (captured, _guard) = Captured::install();
    assert_session_expired(&api.delete(Some("Bearer unknown"), &[]).await, "unknown");
    assert!(captured.named(DELETED).is_empty());
}

// ── The erasure seam ────────────────────────────────────────────────────────

/// A fork's eraser whose database is down.
struct FailingEraser;

impl AccountEraser for FailingEraser {
    fn erase(&self, _user: &SessionUser, _sessions: &Sessions) -> Result<(), ApiError> {
        Err(ApiError::Internal(
            "the accounts table is unavailable".into(),
        ))
    }
}

#[tokio::test]
async fn a_failing_eraser_answers_500_and_keeps_every_session() {
    let api = Api::with_eraser(FailingEraser);
    let device = api.sign_in("citizen_voter", "cookie").await;
    let (captured, _guard) = Captured::install();

    let reply = api.delete_as(&device).await;
    assert_eq!(reply.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(reply.json["code"], "server.internal");
    assert!(reply.header(header::SET_COOKIE).is_none());
    assert!(!reply.json.to_string().contains("accounts table"));
    assert!(captured.named(DELETED).is_empty());
    assert!(api.is_live(&device).await, "nothing was erased");
    assert_eq!(api.refresh(&device).await, StatusCode::OK);
}

// ── Origin check and CORS (REQ-SEC-012, REQ-API-007) ────────────────────────

#[tokio::test]
async fn foreign_origin_cannot_delete_the_account() {
    let api = Api::new();
    let device = api.sign_in("citizen_voter", "cookie").await;

    let refused = api
        .delete(Some(&bearer(&device.access)), &[("origin", FOREIGN_ORIGIN)])
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.json["code"], "auth.forbidden");
    assert!(refused.header(header::SET_COOKIE).is_none());
    assert!(refused
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN)
        .is_none());
    assert_eq!(refused.header(header::CACHE_CONTROL), Some("no-store"));
    assert!(api.is_live(&device).await, "the account survived");

    let allowed = api
        .delete(Some(&bearer(&device.access)), &[("origin", LOCAL_ORIGIN)])
        .await;
    assert_deleted(&allowed);
    assert_eq!(
        allowed.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(LOCAL_ORIGIN)
    );
}

#[tokio::test]
async fn cors_preflight_allows_the_delete_method() {
    let api = Api::new();
    let request = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/v1/account")
        .header(header::ORIGIN, LOCAL_ORIGIN)
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "DELETE")
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
        .body(Body::empty())
        .unwrap();
    let reply = api.send(request).await;
    assert!(reply.status.is_success(), "{}", reply.status);
    let methods = reply.header(header::ACCESS_CONTROL_ALLOW_METHODS).unwrap();
    assert!(methods.contains("DELETE"), "{methods}");
    assert_eq!(
        reply.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(LOCAL_ORIGIN)
    );
}
