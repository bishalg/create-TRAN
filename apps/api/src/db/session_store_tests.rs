use super::*;
use crate::db::tests::{count, exec, pair, registration, t, user};
use crate::db::SqlDeviceStore;
use crate::devices::DeviceStore;

fn store() -> (SqlSessionStore, SqlDeviceStore, Database) {
    let db = Database::in_memory();
    (
        SqlSessionStore::new(db.clone()),
        SqlDeviceStore::new(db.clone()),
        db,
    )
}

fn voter() -> StoredSession {
    user("voter-001", Transport::Body)
}

/// The session behind an access digest, without its id.
fn who(store: &SqlSessionStore, access: &TokenDigest, now: DateTime<Utc>) -> Option<StoredSession> {
    store
        .session_for_access(access, now)
        .unwrap()
        .map(|live| live.session)
}

fn rotate(store: &SqlSessionStore, refresh: u8, next: u8, now: i64) -> Rotation {
    store.rotate(&[refresh; 32], pair(next), t(now)).unwrap()
}

/// Makes every later statement of `kind` on `table` fail on the store's own connection: a failure
/// injected between two steps of one operation (REQ-DB-006).
fn fail_before(db: &Database, kind: &str, table: &str) {
    exec(
        db,
        &format!(
            "CREATE TEMP TRIGGER injected BEFORE {kind} ON main.{table} \
             BEGIN SELECT RAISE(ABORT, 'injected'); END"
        ),
    );
}

fn heal(db: &Database) {
    exec(db, "DROP TRIGGER temp.injected");
}

// Verifies: REQ-SEC-006 REQ-SEC-008
#[test]
fn an_access_digest_is_live_until_it_expires() {
    let (store, _, _) = store();
    store.start(voter(), pair(1)).unwrap();
    assert_eq!(who(&store, &[1; 32], t(899)), Some(voter()));
    assert_eq!(who(&store, &[1; 32], t(900)), None);
    assert_eq!(who(&store, &[9; 32], t(0)), None);
}

// Verifies: REQ-SEC-006 REQ-PSH-003
#[test]
fn each_session_has_its_own_id_and_revoking_names_it() {
    let (store, _, _) = store();
    let first = store.start(voter(), pair(1)).unwrap();
    let second = store.start(voter(), pair(2)).unwrap();
    assert_ne!(first, second);
    let live = store.session_for_access(&[2; 32], t(1)).unwrap().unwrap();
    assert_eq!((live.id, live.session), (second, voter()));
    assert_eq!(store.revoke(&[101; 32]), Ok(Some(first)));
    assert_eq!(store.revoke(&[101; 32]), Ok(None));
    assert_eq!(store.revoke(&[42; 32]), Ok(None));
    assert_eq!(who(&store, &[2; 32], t(1)), Some(voter()));
}

// Verifies: REQ-SEC-009
#[test]
fn rotation_spends_the_token_and_keeps_the_session() {
    let (store, _, _) = store();
    let cookie = user("auditor-001", Transport::Cookie);
    let cookie = StoredSession {
        user: SessionUser {
            role: UserRole::ElectionAuditor,
            ..cookie.user
        },
        ..cookie
    };
    store.start(cookie.clone(), pair(1)).unwrap();
    assert_eq!(
        rotate(&store, 101, 2, 10),
        Rotation::Rotated(cookie.clone())
    );
    assert_eq!(who(&store, &[2; 32], t(10)), Some(cookie.clone()));
    // The old access token stays valid until it expires; only its refresh token is spent.
    assert_eq!(who(&store, &[1; 32], t(10)), Some(cookie.clone()));
    assert_eq!(rotate(&store, 102, 3, 20), Rotation::Rotated(cookie));
}

// Verifies: REQ-SEC-009
#[test]
fn unknown_and_expired_refresh_tokens_are_refused() {
    let (store, _, _) = store();
    store.start(voter(), pair(1)).unwrap();
    assert_eq!(rotate(&store, 7, 2, 0), Rotation::Unknown);
    assert_eq!(rotate(&store, 101, 2, 2_000), Rotation::Expired);
}

// Verifies: REQ-SEC-010 REQ-PSH-003
#[test]
fn a_replayed_refresh_token_ends_the_session_with_its_registrations() {
    let (store, devices, _) = store();
    let id = store.start(voter(), pair(1)).unwrap();
    devices
        .register(registration(1, "voter-001", id, 'a'))
        .unwrap();
    rotate(&store, 101, 2, 10);
    assert_eq!(rotate(&store, 101, 3, 11), Rotation::Replayed(id));
    assert_eq!(who(&store, &[1; 32], t(12)), None);
    assert_eq!(who(&store, &[2; 32], t(12)), None);
    assert_eq!(rotate(&store, 102, 4, 12), Rotation::Unknown);
    assert!(devices.for_user("voter-001").unwrap().is_empty());
}

// Verifies: REQ-SEC-011
#[test]
fn revoking_ends_the_family_and_ignores_unknown_tokens() {
    let (store, _, _) = store();
    store.start(voter(), pair(1)).unwrap();
    let other = user("voter-001", Transport::Cookie);
    store.start(other.clone(), pair(5)).unwrap();
    store.revoke(&[42; 32]).unwrap();
    store.revoke(&[101; 32]).unwrap();
    assert_eq!(who(&store, &[1; 32], t(1)), None);
    assert_eq!(rotate(&store, 101, 2, 1), Rotation::Unknown);
    assert_eq!(who(&store, &[5; 32], t(1)), Some(other));
}

// Verifies: REQ-ACC-002 REQ-ACC-003 REQ-PSH-003
#[test]
fn revoking_a_user_ends_every_session_of_that_user_and_leaves_no_record_of_them() {
    let (store, devices, db) = store();
    let first = store.start(voter(), pair(1)).unwrap();
    store
        .start(user("voter-001", Transport::Cookie), pair(2))
        .unwrap();
    rotate(&store, 102, 3, 1);
    devices
        .register(registration(1, "voter-001", first, 'a'))
        .unwrap();
    let other = user("auditor-001", Transport::Body);
    let theirs = store.start(other.clone(), pair(4)).unwrap();
    devices
        .register(registration(2, "auditor-001", theirs, 'b'))
        .unwrap();

    store.revoke_user("voter-001").unwrap();
    for access in [[1; 32], [2; 32], [3; 32]] {
        assert_eq!(who(&store, &access, t(2)), None);
    }
    for refresh in [101, 102, 103] {
        assert_eq!(rotate(&store, refresh, 9, 2), Rotation::Unknown);
    }
    assert_eq!(who(&store, &[4; 32], t(2)), Some(other.clone()));
    assert_eq!(count(&db, "sessions"), 1);
    assert_eq!(count(&db, "access_tokens"), 1);
    assert_eq!(count(&db, "refresh_tokens"), 1);
    assert_eq!(count(&db, "device_registrations"), 1);
    assert_eq!(rotate(&store, 104, 5, 2), Rotation::Rotated(other));
    store.revoke_user("nobody").unwrap();
}

// Verifies: REQ-SEC-006 REQ-DB-010
#[test]
fn only_digests_are_stored() {
    let (store, _, db) = store();
    store.start(voter(), pair(1)).unwrap();
    let digest: Vec<u8> = db
        .read(|c| c.query_row("SELECT digest FROM refresh_tokens", [], |r| r.get(0)))
        .unwrap();
    assert_eq!(digest, [101; 32]);
}

// Verifies: REQ-DB-009
#[test]
fn pruning_removes_expired_digests_and_sessions_past_their_refresh_lifetime() {
    let (store, _, db) = store();
    store.start(voter(), pair(1)).unwrap();
    rotate(&store, 101, 2, 10);
    let late = PairDigests {
        refresh_expires_at: t(5_000),
        ..pair(3)
    };
    store.start(voter(), late).unwrap();

    assert_eq!(store.prune(t(899)).unwrap(), SessionsPruned::default());
    // Every access digest expires at 900 s; the first session's refresh digests at 2 000 s.
    assert_eq!(
        store.prune(t(900)).unwrap(),
        SessionsPruned {
            sessions: 0,
            tokens: 3
        }
    );
    assert_eq!(
        store.prune(t(2_000)).unwrap(),
        SessionsPruned {
            sessions: 1,
            tokens: 2
        }
    );
    assert_eq!(count(&db, "sessions"), 1);
    assert_eq!(rotate(&store, 103, 4, 2_001), Rotation::Rotated(voter()));
}

// Verifies: REQ-DB-006
#[test]
fn a_rotation_that_fails_part_way_changes_nothing() {
    let (store, _, db) = store();
    store.start(voter(), pair(1)).unwrap();
    // The token is spent and the new access digest written before this insert fails.
    fail_before(&db, "INSERT", "refresh_tokens");
    assert_eq!(
        store.rotate(&[101; 32], pair(2), t(10)),
        Err(StoreError::Failed)
    );
    heal(&db);
    assert_eq!(who(&store, &[2; 32], t(10)), None, "no new access digest");
    assert_eq!(
        rotate(&store, 101, 3, 10),
        Rotation::Rotated(voter()),
        "not spent"
    );
}

// Verifies: REQ-DB-006
#[test]
fn revoking_a_session_that_fails_part_way_keeps_its_registrations() {
    let (store, devices, db) = store();
    let id = store.start(voter(), pair(1)).unwrap();
    devices
        .register(registration(1, "voter-001", id, 'a'))
        .unwrap();
    // The registrations are deleted before the session's delete fails.
    fail_before(&db, "DELETE", "sessions");
    assert_eq!(store.revoke(&[101; 32]), Err(StoreError::Failed));
    assert_eq!(rotate(&store, 101, 2, 10), Rotation::Rotated(voter()));
    assert_eq!(
        store.rotate(&[101; 32], pair(3), t(11)),
        Err(StoreError::Failed),
        "a replay whose ending fails ends nothing"
    );
    heal(&db);
    assert_eq!(devices.for_user("voter-001").unwrap().len(), 1);
    assert_eq!(who(&store, &[1; 32], t(12)), Some(voter()));
}

// Verifies: REQ-DB-006
#[test]
fn erasing_an_account_that_fails_part_way_keeps_everything() {
    let (store, devices, db) = store();
    let id = store.start(voter(), pair(1)).unwrap();
    devices
        .register(registration(1, "voter-001", id, 'a'))
        .unwrap();
    fail_before(&db, "DELETE", "sessions");
    assert_eq!(store.revoke_user("voter-001"), Err(StoreError::Failed));
    heal(&db);
    assert_eq!(devices.for_user("voter-001").unwrap().len(), 1);
    assert_eq!(who(&store, &[1; 32], t(1)), Some(voter()));
}

// Verifies: REQ-DB-008
#[test]
fn a_broken_row_is_a_store_failure_not_a_panic() {
    let (store, _, db) = store();
    exec(
        &db,
        "PRAGMA ignore_check_constraints = ON; \
         INSERT INTO sessions (id, user_id, role, transport) VALUES (7, 'u', 'admin', 'body'); \
         INSERT INTO access_tokens VALUES (zeroblob(32), 7, 9999999999999);",
    );
    assert_eq!(
        store.session_for_access(&[0; 32], t(0)),
        Err(StoreError::Failed)
    );
    exec(&db, "DROP TABLE refresh_tokens");
    assert_eq!(store.prune(t(0)), Err(StoreError::Failed));
    assert_eq!(store.start(voter(), pair(1)), Err(StoreError::Failed));
}
