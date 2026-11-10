// Verifies: REQ-PSH-005 REQ-PSH-009
//! The device policy and the `push_sync` table from `fixtures/push.json`, shared with TypeScript,
//! UniFFI and native.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;

use rust_core::push::{push_sync, LastRegistration, PushAction, PushState, DEVICE_POLICY};
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/push.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    policy: Policy,
    sync: Vec<SyncCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    stale_after_days: u32,
    refresh_after_days: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncCase {
    name: String,
    push_available: bool,
    permission_granted: bool,
    has_session: bool,
    current_token: Option<String>,
    last_registration: Option<Recorded>,
    now_unix_s: i64,
    action: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recorded {
    token: String,
    registered_at_unix_s: i64,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/push.json")
}

impl SyncCase {
    fn state(&self) -> PushState<'_> {
        PushState {
            push_available: self.push_available,
            permission_granted: self.permission_granted,
            has_session: self.has_session,
            current_token: self.current_token.as_deref(),
            last_registration: self.last_registration.as_ref().map(|r| LastRegistration {
                token: &r.token,
                registered_at_unix_s: r.registered_at_unix_s,
            }),
            now_unix_s: self.now_unix_s,
        }
    }
}

#[test]
fn the_policy_matches_the_fixture() {
    let policy = fixtures().policy;
    assert_eq!(policy.stale_after_days, DEVICE_POLICY.stale_after_days);
    assert_eq!(policy.refresh_after_days, DEVICE_POLICY.refresh_after_days);
}

#[test]
fn every_sync_case_gives_its_action() {
    for case in fixtures().sync {
        assert_eq!(
            push_sync(&case.state()).as_str(),
            case.action,
            "{}",
            case.name
        );
    }
}

/// Every combination of the three switches, a token or none, and each kind of record is a row.
#[test]
fn the_table_enumerates_every_combination() {
    let cases = fixtures().sync;
    let names: BTreeSet<&str> = cases.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names.len(), cases.len(), "names are unique");
    let record = |c: &SyncCase| match &c.last_registration {
        None => "none",
        Some(r) if Some(&r.token) != c.current_token.as_ref() => "other",
        Some(r) if c.now_unix_s - r.registered_at_unix_s == 0 => "fresh",
        Some(_) => "aged",
    };
    let seen: BTreeSet<(bool, bool, bool, bool, &str)> = cases
        .iter()
        .map(|c| {
            (
                c.push_available,
                c.permission_granted,
                c.has_session,
                c.current_token.is_some(),
                record(c),
            )
        })
        .collect();
    for available in [false, true] {
        for granted in [false, true] {
            for session in [false, true] {
                for token in [false, true] {
                    let records: &[&str] = if token {
                        &["none", "fresh", "aged", "other"]
                    } else {
                        &["none", "other"]
                    };
                    for kind in records {
                        assert!(
                            seen.contains(&(available, granted, session, token, *kind)),
                            "missing: {available} {granted} {session} {token} {kind}"
                        );
                    }
                }
            }
        }
    }
    let actions: BTreeSet<&str> = cases.iter().map(|c| c.action.as_str()).collect();
    let all: BTreeSet<&str> = PushAction::ALL.iter().map(|a| a.as_str()).collect();
    assert_eq!(actions, all, "every action is pinned");
}
