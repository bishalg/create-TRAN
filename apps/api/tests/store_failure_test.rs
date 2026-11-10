// Verifies: REQ-DB-008
//! A database that is locked by another process, or broken under the running API, answers
//! `503 server.unavailable` in the envelope with one logged event: never a panic, never a hang
//! past `busy_timeout_ms`, never SQL text or SQLite's own message.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::prune::run_once;
use api::db::{DbPolicy, StoreError, DB_POLICY};
use api::push::payload::{OpaqueId, ELIGIBILITY_REACHED};
use api::push::sender::FakeSender;
use api::push::Push;
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use support::db::TempDb;
use support::Captured;
use tower::ServiceExt;

/// Short, so a locked database answers quickly here; the real one is `DB_POLICY`.
const IMPATIENT: DbPolicy = DbPolicy {
    busy_timeout_ms: 50,
    ..DB_POLICY
};

const PHONE: &str = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c";

/// The log tests share the `request failed` call site; they take turns (docs/LEARNINGS.md).
static SERIAL: Mutex<()> = Mutex::new(());

struct Api {
    file: TempDb,
    state: AppState,
    _serial: MutexGuard<'static, ()>,
}

struct Reply {
    status: StatusCode,
    json: Value,
    raw: String,
}

impl Api {
    fn new() -> Self {
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        let file = TempDb::new();
        file.open();
        let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let state = AppState {
            sessions: Sessions::sql(
                file.open_with(&IMPATIENT),
                Arc::new(ManualClock::starting_at(start)),
            ),
            ..AppState::from_config(&AppConfig::from_lookup(|_| None))
        };
        Self {
            file,
            state,
            _serial: serial,
        }
    }

    async fn send(&self, method: Method, uri: &str, bearer: Option<&str>, body: Value) -> Reply {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = bearer {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let request = request.body(Body::from(body.to_string())).unwrap();
        let response = build_app(self.state.clone())
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            raw: String::from_utf8_lossy(&bytes).into_owned(),
        }
    }

    async fn sign_in(&self) -> Reply {
        let body = json!({ "role": "citizen_voter", "transport": "body" });
        self.send(Method::POST, "/api/v1/auth/session", None, body)
            .await
    }
}

fn device() -> Value {
    json!({
        "platform": "ios",
        "push_token": "ab".repeat(32),
        "environment": "sandbox",
        "locale": "en",
        "app_version": "1.4.0"
    })
}

/// What no response or log line may contain: SQL, table names, SQLite's messages.
const NEVER: [&str; 10] = [
    "INSERT INTO",
    "SELECT ",
    "DELETE FROM",
    "UPDATE ",
    "access_tokens",
    "refresh_tokens",
    "device_registrations",
    "locked",
    "no such table",
    "SQLITE",
];

fn assert_unavailable(reply: &Reply, label: &str) {
    assert_eq!(
        reply.status,
        StatusCode::SERVICE_UNAVAILABLE,
        "{label}: {}",
        reply.raw
    );
    assert_eq!(reply.json["code"], "server.unavailable", "{label}");
    assert_eq!(reply.json["retryable"], true, "{label}");
    assert_eq!(reply.json["success"], false, "{label}");
    for never in NEVER {
        assert!(
            !reply.raw.contains(never),
            "{label} leaks {never}: {}",
            reply.raw
        );
    }
}

fn assert_one_clean_event(captured: &Captured, label: &str) {
    let failed = captured.named("request failed");
    assert_eq!(failed.len(), 1, "{label}: {failed:?}");
    assert_eq!(
        failed[0].field("code"),
        Some("server.unavailable"),
        "{label}"
    );
    for event in captured.events() {
        for never in NEVER {
            assert!(
                !event.line().contains(never),
                "{label} logs {never}: {}",
                event.line()
            );
        }
    }
}

#[tokio::test]
async fn a_database_locked_by_another_process_answers_503_within_the_busy_timeout() {
    let api = Api::new();
    let signed_in = api.sign_in().await;
    let access = signed_in.json["access_token"].as_str().unwrap().to_string();
    let refresh = signed_in.json["refresh_token"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        api.send(
            Method::PUT,
            &format!("/api/v1/devices/{PHONE}"),
            Some(&access),
            device()
        )
        .await
        .status,
        StatusCode::NO_CONTENT
    );

    let other_process = api.file.raw();
    other_process.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let writes: [(&str, Method, String, Option<&str>, Value); 6] = [
        (
            "sign in",
            Method::POST,
            "/api/v1/auth/session".into(),
            None,
            json!({ "role": "citizen_voter", "transport": "body" }),
        ),
        (
            "refresh",
            Method::POST,
            "/api/v1/auth/refresh".into(),
            None,
            json!({ "refresh_token": refresh }),
        ),
        (
            "sign out",
            Method::POST,
            "/api/v1/auth/sign-out".into(),
            None,
            json!({ "refresh_token": refresh }),
        ),
        (
            "register",
            Method::PUT,
            format!("/api/v1/devices/{PHONE}"),
            Some(&access),
            device(),
        ),
        (
            "unregister",
            Method::DELETE,
            format!("/api/v1/devices/{PHONE}"),
            Some(&access),
            json!({}),
        ),
        (
            "delete account",
            Method::DELETE,
            "/api/v1/account".into(),
            Some(&access),
            json!({}),
        ),
    ];
    for (label, method, uri, bearer, body) in writes {
        let (captured, guard) = Captured::install();
        let started = Instant::now();
        let reply = api.send(method, &uri, bearer, body).await;
        drop(guard);
        assert_unavailable(&reply, label);
        assert_one_clean_event(&captured, label);
        assert!(
            started.elapsed() < Duration::from_millis(IMPATIENT.busy_timeout_ms * 20),
            "{label} waited {:?}",
            started.elapsed()
        );
    }

    other_process.execute_batch("ROLLBACK").unwrap();
    let whoami = api
        .send(
            Method::GET,
            "/api/v1/auth/session",
            Some(&access),
            Value::Null,
        )
        .await;
    assert_eq!(
        whoami.status,
        StatusCode::OK,
        "nothing was lost: {}",
        whoami.raw
    );
    assert_eq!(api.sign_in().await.status, StatusCode::CREATED);
}

#[tokio::test]
async fn a_database_broken_under_the_api_answers_503_and_logs_once() {
    let api = Api::new();
    let signed_in = api.sign_in().await;
    let access = signed_in.json["access_token"].as_str().unwrap().to_string();
    api.file
        .raw()
        .execute_batch("DROP TABLE access_tokens")
        .unwrap();

    let (captured, guard) = Captured::install();
    let reply = api
        .send(
            Method::GET,
            "/api/v1/auth/session",
            Some(&access),
            Value::Null,
        )
        .await;
    drop(guard);
    assert_unavailable(&reply, "who am I");
    assert_one_clean_event(&captured, "who am I");
}

#[tokio::test]
async fn background_work_on_a_broken_database_fails_without_a_panic() {
    let api = Api::new();
    api.file
        .raw()
        .execute_batch("DROP TABLE device_registrations")
        .unwrap();

    let push = Push::new(
        &api.state.sessions,
        Arc::new(FakeSender::default()),
        "topic",
    );
    let id = OpaqueId::parse("evt-1").unwrap();
    assert_eq!(
        push.notify("voter-001", &ELIGIBILITY_REACHED, &id).await,
        Err(StoreError::Failed)
    );

    let (captured, guard) = Captured::install();
    assert_eq!(run_once(&api.state.sessions).await, Err(StoreError::Failed));
    drop(guard);
    let failed = captured.named("database prune failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].field("error"), Some("the database failed"));
}
