//! The device registry harness shared by `devices_test.rs` and `push_test.rs`: the real router,
//! the SQL stores on an in-memory database, a manual clock and a fake push sender.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::prune::{run_once, PruneReport};
use api::db::Database;
use api::devices::Registration;
use api::push::sender::FakeSender;
use api::push::Push;
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

pub const LOCAL_ORIGIN: &str = "http://localhost:3000";
pub const FOREIGN_ORIGIN: &str = "https://evil.example";
pub const TOPIC: &str = "com.tran.voting";
pub const PHONE: &str = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c";
pub const TABLET: &str = "7d4e9b21-3c5a-4f8e-a1b2-c3d4e5f6a7b8";
pub const IOS_TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
pub const IOS_TOKEN_2: &str = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

pub fn android_token() -> String {
    format!("cXk9Ry:APA91b{}", "Qw_-8".repeat(28))
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub json: Value,
    pub raw: String,
}

impl Reply {
    pub fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }
}

/// One signed-in session: what an app holds.
pub struct Session {
    pub access: String,
    pub refresh: String,
}

/// Every test here logs from the same call sites. `tracing` caches whether a call site is enabled
/// when a thread without a subscriber hits it first, so a test running beside the log test could
/// hide that test's events; the tests take turns instead.
static SERIAL: Mutex<()> = Mutex::new(());

/// Waits for this binary's other tests to finish logging; held until the guard drops.
pub fn take_turn() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct Api {
    pub state: AppState,
    pub clock: Arc<ManualClock>,
    pub sender: Arc<FakeSender>,
    _serial: MutexGuard<'static, ()>,
}

impl Api {
    pub fn new() -> Self {
        let serial = take_turn();
        let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let clock = Arc::new(ManualClock::starting_at(start));
        let state = AppState {
            sessions: Sessions::sql(Database::in_memory(), clock.clone()),
            ..AppState::from_config(&AppConfig::from_lookup(|_| None))
        };
        Self {
            state,
            clock,
            sender: Arc::new(FakeSender::default()),
            _serial: serial,
        }
    }

    /// One run of the database prune, as the server's task runs it (REQ-DB-009).
    pub async fn prune(&self) -> PruneReport {
        run_once(&self.state.sessions).await.unwrap()
    }

    pub fn push(&self) -> Push {
        Push::new(&self.state.sessions, self.sender.clone(), TOPIC)
    }

    pub async fn send(&self, request: Request<Body>) -> Reply {
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
            raw: String::from_utf8_lossy(&bytes).into_owned(),
        }
    }

    pub async fn sign_in(&self, role: &str) -> Session {
        let body = json!({ "role": role, "transport": "body" }).to_string();
        let reply = self.send(post("/api/v1/auth/session", body)).await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.raw);
        Session {
            access: reply.json["access_token"].as_str().unwrap().to_string(),
            refresh: reply.json["refresh_token"].as_str().unwrap().to_string(),
        }
    }

    pub async fn put_raw(
        &self,
        session: &Session,
        id: &str,
        body: String,
        extra: &[(&str, &str)],
    ) -> Reply {
        let mut builder = Request::builder()
            .method(Method::PUT)
            .uri(format!("/api/v1/devices/{id}"))
            .header(header::AUTHORIZATION, bearer(&session.access))
            .header(header::CONTENT_TYPE, "application/json");
        for (name, value) in extra {
            builder = builder.header(*name, *value);
        }
        self.send(builder.body(Body::from(body)).unwrap()).await
    }

    pub async fn register(&self, session: &Session, id: &str, body: Value) -> Reply {
        self.put_raw(session, id, body.to_string(), &[]).await
    }

    pub async fn unregister(&self, session: &Session, id: &str) -> Reply {
        let request = Request::builder()
            .method(Method::DELETE)
            .uri(format!("/api/v1/devices/{id}"))
            .header(header::AUTHORIZATION, bearer(&session.access))
            .body(Body::empty())
            .unwrap();
        self.send(request).await
    }

    pub fn registrations(&self, user_id: &str) -> Vec<Registration> {
        let mut found = self.state.sessions.devices().for_user(user_id).unwrap();
        found.sort_by_key(|r| r.token.expose().to_string());
        found
    }

    pub fn tokens(&self, user_id: &str) -> Vec<String> {
        self.registrations(user_id)
            .iter()
            .map(|r| r.token.expose().to_string())
            .collect()
    }
}

pub fn post(uri: &str, body: String) -> Request<Body> {
    Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

pub fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

pub fn ios(token: &str) -> Value {
    json!({
        "platform": "ios",
        "push_token": token,
        "environment": "sandbox",
        "locale": "ne-NP",
        "app_version": "1.4.0",
        "marketing": false
    })
}

pub fn android(token: &str) -> Value {
    json!({
        "platform": "android",
        "push_token": token,
        "environment": "production",
        "locale": "hi",
        "app_version": "1.4.0+12"
    })
}

pub fn assert_no_content(reply: &Reply, label: &str) {
    assert_eq!(
        reply.status,
        StatusCode::NO_CONTENT,
        "{label}: {}",
        reply.raw
    );
    assert!(reply.raw.is_empty(), "{label}: 204 has no body");
    assert_eq!(
        reply.header(header::CACHE_CONTROL),
        Some("no-store"),
        "{label}"
    );
}

pub fn assert_malformed(reply: &Reply, label: &str) {
    assert_eq!(
        reply.status,
        StatusCode::BAD_REQUEST,
        "{label}: {}",
        reply.raw
    );
    assert_eq!(reply.json["code"], "request.malformed", "{label}");
    assert_eq!(
        reply.header(header::CACHE_CONTROL),
        Some("no-store"),
        "{label}"
    );
}
