// Verifies: REQ-DB-009 REQ-PSH-005
//! Expired rows are deleted on a schedule and by `api prune` (spec 030 REQ-DB-009): sessions past
//! their refresh lifetime, token digests past their expiry (spent ones included) and registrations
//! not refreshed for sixty days. The log says how many, never which.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::time::Duration as Wait;

use api::commands;
use api::db::prune::{spawn, PruneReport};
use api::db::SqlSessionStore;
use api::session_store::{PairDigests, SessionStore, SessionUser, StoredSession, Transport};
use chrono::{Duration, Utc};
use rust_core::UserRole;
use serde_json::json;
use support::db::TempDb;
use support::devices::*;
use support::Captured;
use tracing::Level;

#[tokio::test]
async fn prune_deletes_what_expired_and_logs_counts_only() {
    let api = Api::new();
    let voter = api.sign_in("citizen_voter").await;
    assert_no_content(&api.register(&voter, PHONE, ios(IOS_TOKEN)).await, "phone");
    let body = json!({ "refresh_token": voter.refresh }).to_string();
    let rotated = api.send(post("/api/v1/auth/refresh", body)).await;
    assert_eq!(rotated.status.as_u16(), 200, "{}", rotated.raw);
    let (captured, _guard) = Captured::install();

    assert_eq!(
        api.prune().await,
        PruneReport::default(),
        "nothing expired yet"
    );
    api.clock.advance(Duration::days(30));
    assert_eq!(
        api.prune().await,
        PruneReport {
            sessions: 1,
            tokens: 4,
            devices: 0
        },
        "two pairs, the spent refresh token included; the phone is not stale yet"
    );
    assert_eq!(
        api.tokens("voter-001"),
        [IOS_TOKEN],
        "a registration outlives an expired session"
    );
    api.clock.advance(Duration::days(30));
    assert_eq!(api.prune().await.devices, 1);

    let pruned = captured.named("database pruned");
    assert_eq!(pruned.len(), 3);
    assert_eq!(pruned[1].level, Level::INFO);
    let fields: Vec<&str> = pruned[1].fields.keys().map(String::as_str).collect();
    assert_eq!(fields, ["devices", "sessions", "tokens"]);
    assert_eq!(
        (pruned[1].field("sessions"), pruned[1].field("tokens")),
        (Some("1"), Some("4"))
    );
    for event in captured.events() {
        let line = event.line();
        for secret in [
            IOS_TOKEN,
            PHONE,
            "voter-001",
            voter.access.as_str(),
            voter.refresh.as_str(),
        ] {
            assert!(!line.contains(secret), "log leaks {secret}: {line}");
        }
    }
}

#[tokio::test]
async fn the_task_prunes_on_start_and_then_on_its_interval_by_the_injected_clock() {
    let api = Api::new();
    api.sign_in("citizen_voter").await;
    let (captured, _guard) = Captured::install();
    let task = spawn(api.state.sessions.clone(), Wait::from_millis(20));

    let removed_sessions = || {
        captured
            .named("database pruned")
            .iter()
            .filter(|event| event.field("sessions") == Some("1"))
            .count()
    };
    tokio::time::sleep(Wait::from_millis(60)).await;
    assert!(
        captured.named("database pruned").len() >= 2,
        "on start, then on the interval"
    );
    assert_eq!(removed_sessions(), 0, "the clock has not moved");

    api.clock.advance(Duration::days(30));
    for _ in 0..100 {
        if removed_sessions() == 1 {
            break;
        }
        tokio::time::sleep(Wait::from_millis(10)).await;
    }
    task.abort();
    assert_eq!(removed_sessions(), 1, "the next tick saw the clock move");
}

fn expired_session(store: &SqlSessionStore) {
    let long_ago = Utc::now() - Duration::days(31);
    let user = SessionUser {
        user_id: "voter-001".into(),
        role: UserRole::CitizenVoter,
    };
    let pair = PairDigests {
        access: [1; 32],
        access_expires_at: long_ago,
        refresh: [2; 32],
        refresh_expires_at: long_ago,
    };
    let session = StoredSession {
        user,
        transport: Transport::Body,
    };
    store.start(session, pair).unwrap();
}

#[tokio::test]
#[allow(clippy::await_holding_lock)]
async fn api_prune_runs_once_on_the_real_clock_and_refuses_an_unmigrated_database() {
    let _turn = take_turn();
    let unmigrated = TempDb::new();
    let refused = commands::prune(&unmigrated.config(&[])).await.unwrap_err();
    assert_eq!(refused.exit_code, 2);
    assert!(
        refused.message.contains("run `api migrate`"),
        "{}",
        refused.message
    );

    let file = TempDb::new();
    expired_session(&SqlSessionStore::new(file.open()));
    assert_eq!(
        commands::prune(&file.config(&[])).await,
        Ok(PruneReport {
            sessions: 1,
            tokens: 2,
            devices: 0
        })
    );
    file.raw().execute_batch("DROP TABLE sessions").unwrap();
    assert_eq!(
        commands::prune(&file.config(&[]))
            .await
            .unwrap_err()
            .message,
        "the database failed"
    );
}
