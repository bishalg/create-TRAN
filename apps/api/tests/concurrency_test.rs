// Verifies: REQ-DB-007 REQ-SEC-010 REQ-PSH-002
//! Concurrent requests cannot both win (spec 030 REQ-DB-007). Each racer has its own connection to
//! one file database, as separate API processes would, and they start together; the database
//! decides (`UPDATE … WHERE spent = 0` and its row count; the unique push token), not a check in
//! Rust. Every race is repeated.
//!
//! The exact outcome of `RACERS` rotations of one refresh token: one `Rotated` (the token is spent
//! and a new pair issued), then one `Replayed` (the next racer finds the token spent and ends the
//! whole session, the winner's new pair with it, REQ-SEC-010), then `Unknown` for every other racer
//! (the token went with its session). Every loser is refused alike, and the session ends revoked.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::{Arc, Barrier};

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::{Database, SqlDeviceStore, SqlSessionStore};
use api::devices::{
    DevicePlatform, DeviceStore, InstallationId, PushEnvironment, PushToken, Registration,
};
use api::session_store::{
    PairDigests, Rotation, SessionId, SessionStore, SessionUser, StoredSession, Transport,
};
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use chrono::{DateTime, Duration, Utc};
use http_body_util::BodyExt;
use rust_core::UserRole;
use serde_json::{json, Value};
use support::db::TempDb;
use tower::ServiceExt;

const RACERS: usize = 8;
const ROUNDS: usize = 15;

fn now() -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap()
}

/// Pair `n`: digests `[n; 32]` and `[n + 100; 32]`, live for an hour.
fn pair(n: u8) -> PairDigests {
    PairDigests {
        access: [n; 32],
        access_expires_at: now() + Duration::minutes(15),
        refresh: [n + 100; 32],
        refresh_expires_at: now() + Duration::hours(1),
    }
}

fn voter(user_id: &str) -> StoredSession {
    StoredSession {
        user: SessionUser {
            user_id: user_id.into(),
            role: UserRole::CitizenVoter,
        },
        transport: Transport::Body,
    }
}

/// Runs `race(racer, its own connection)` on `RACERS` threads that start together.
fn race<T: Send + 'static>(
    file: &TempDb,
    race: impl Fn(usize, Database) -> T + Send + Sync + 'static,
) -> Vec<T> {
    let (barrier, race) = (Arc::new(Barrier::new(RACERS)), Arc::new(race));
    let racers: Vec<_> = (0..RACERS)
        .map(|racer| {
            let (barrier, race, db) = (barrier.clone(), race.clone(), file.open());
            std::thread::spawn(move || {
                barrier.wait();
                race(racer, db)
            })
        })
        .collect();
    racers.into_iter().map(|r| r.join().unwrap()).collect()
}

// Verifies: REQ-DB-007 REQ-SEC-010
#[test]
fn parallel_rotations_of_one_refresh_token_issue_exactly_one_pair() {
    for _ in 0..ROUNDS {
        let file = TempDb::new();
        let sessions = SqlSessionStore::new(file.open());
        let id = sessions.start(voter("voter-001"), pair(1)).unwrap();

        let outcomes = race(&file, |racer, db| {
            let next = pair(u8::try_from(racer).unwrap() + 10);
            SqlSessionStore::new(db).rotate(&[101; 32], next, now())
        });
        let outcomes: Vec<Rotation> = outcomes.into_iter().map(Result::unwrap).collect();
        let rotated = outcomes
            .iter()
            .filter(|o| matches!(o, Rotation::Rotated(_)))
            .count();
        let replayed: Vec<&Rotation> = outcomes
            .iter()
            .filter(|o| matches!(o, Rotation::Replayed(_)))
            .collect();
        let unknown = outcomes.iter().filter(|o| **o == Rotation::Unknown).count();
        assert_eq!(
            (rotated, replayed.len(), unknown),
            (1, 1, RACERS - 2),
            "{outcomes:?}"
        );
        assert_eq!(replayed[0], &Rotation::Replayed(id));
        let left: i64 = file
            .raw()
            .query_row("SELECT count(*) FROM refresh_tokens", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            left, 0,
            "the session ends revoked, the winner's pair with it"
        );
    }
}

fn registration(racer: usize, session: SessionId, user_id: &str) -> Registration {
    Registration {
        installation: InstallationId::random(),
        user_id: user_id.into(),
        session,
        platform: DevicePlatform::Ios,
        environment: PushEnvironment::Production,
        token: PushToken::parse(DevicePlatform::Ios, &"ab".repeat(32)).unwrap(),
        locale: "en".into(),
        app_version: format!("1.0.{racer}"),
        marketing: false,
        refreshed_at: now(),
    }
}

// Verifies: REQ-DB-007 REQ-PSH-002
#[test]
fn parallel_registrations_of_one_push_token_leave_exactly_one() {
    for _ in 0..ROUNDS {
        let file = TempDb::new();
        let sessions = SqlSessionStore::new(file.open());
        let owners: Vec<(SessionId, String)> = (0..RACERS)
            .map(|racer| {
                let user_id = format!("voter-{racer:03}");
                let n = u8::try_from(racer).unwrap() + 1;
                (sessions.start(voter(&user_id), pair(n)).unwrap(), user_id)
            })
            .collect();
        let owners = Arc::new(owners);

        let displaced: usize = race(&file, move |racer, db| {
            let (session, user_id) = &owners[racer];
            SqlDeviceStore::new(db)
                .register(registration(racer, *session, user_id))
                .unwrap()
        })
        .into_iter()
        .sum();
        assert_eq!(
            displaced,
            RACERS - 1,
            "each later registration moved the token once"
        );
        let holders: i64 = file
            .raw()
            .query_row("SELECT count(*) FROM device_registrations", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(holders, 1);
    }
}

/// The same race through the router: one database, many requests in flight on a multi-threaded
/// runtime, one success.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn parallel_refresh_requests_answer_one_new_pair() {
    for _ in 0..ROUNDS {
        let clock = Arc::new(ManualClock::starting_at(now()));
        let state = AppState {
            sessions: Sessions::sql(Database::in_memory(), clock),
            ..AppState::from_config(&AppConfig::from_lookup(|_| None))
        };
        let app = build_app(state);
        let signed_in = call(
            &app,
            "/api/v1/auth/session",
            json!({ "role": "citizen_voter", "transport": "body" }),
        )
        .await;
        let refresh = signed_in.1["refresh_token"].as_str().unwrap().to_string();

        let requests: Vec<_> = (0..RACERS)
            .map(|_| {
                let (app, body) = (app.clone(), json!({ "refresh_token": refresh }));
                tokio::spawn(async move { call(&app, "/api/v1/auth/refresh", body).await.0 })
            })
            .collect();
        let mut statuses = Vec::new();
        for request in requests {
            statuses.push(request.await.unwrap());
        }
        let ok = statuses.iter().filter(|s| **s == StatusCode::OK).count();
        let refused = statuses
            .iter()
            .filter(|s| **s == StatusCode::UNAUTHORIZED)
            .count();
        assert_eq!((ok, refused), (1, RACERS - 1), "{statuses:?}");
    }
}

async fn call(app: &axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
