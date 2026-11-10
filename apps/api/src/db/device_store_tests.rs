use super::*;
use crate::db::tests::{exec, pair, registration, t, user};
use crate::db::SqlSessionStore;
use crate::session_store::{SessionStore, Transport};

struct Fixture {
    db: Database,
    sessions: SqlSessionStore,
    devices: SqlDeviceStore,
}

impl Fixture {
    fn new() -> Self {
        let db = Database::in_memory();
        Self {
            sessions: SqlSessionStore::new(db.clone()),
            devices: SqlDeviceStore::new(db.clone()),
            db,
        }
    }

    /// A live session of `user_id`, from pair `n`.
    fn session(&self, user_id: &str, n: u8) -> SessionId {
        self.sessions
            .start(user(user_id, Transport::Body), pair(n))
            .unwrap()
    }

    fn register(&self, registration: Registration) -> usize {
        self.devices.register(registration).unwrap()
    }

    /// `<session><first token character>` of each registration of `user_id`.
    fn installations(&self, user_id: &str) -> Vec<String> {
        let mut found: Vec<String> = self
            .devices
            .for_user(user_id)
            .unwrap()
            .iter()
            .map(|r| {
                format!(
                    "{}{}",
                    r.session.0,
                    r.token.expose().chars().next().unwrap()
                )
            })
            .collect();
        found.sort();
        found
    }
}

// Verifies: REQ-PSH-001
#[test]
fn registering_again_replaces_the_installations_registration() {
    let f = Fixture::new();
    let (first, second) = (f.session("voter-001", 1), f.session("voter-001", 2));
    assert_eq!(f.register(registration(1, "voter-001", first, 'a')), 0);
    let refreshed = Registration {
        refreshed_at: t(60),
        marketing: true,
        environment: PushEnvironment::Sandbox,
        ..registration(1, "voter-001", second, 'b')
    };
    assert_eq!(f.register(refreshed.clone()), 0);
    assert_eq!(f.devices.for_user("voter-001").unwrap(), [refreshed]);
}

// Verifies: REQ-PSH-001
#[test]
fn an_android_registration_reads_back_as_written() {
    let f = Fixture::new();
    let session = f.session("voter-001", 1);
    let token = format!("cXk9Ry:APA91b{}", "Qw_-8".repeat(28));
    let android = Registration {
        platform: DevicePlatform::Android,
        token: PushToken::parse(DevicePlatform::Android, &token).unwrap(),
        locale: "ne-NP".into(),
        ..registration(1, "voter-001", session, 'a')
    };
    f.register(android.clone());
    assert_eq!(f.devices.for_user("voter-001").unwrap(), [android]);
}

// Verifies: REQ-PSH-002
#[test]
fn a_token_moves_to_its_newest_owner() {
    let f = Fixture::new();
    let (voter, auditor) = (f.session("voter-001", 1), f.session("auditor-001", 2));
    f.register(registration(1, "voter-001", voter, 'a'));
    f.register(registration(2, "voter-001", voter, 'c'));
    assert_eq!(f.register(registration(3, "auditor-001", auditor, 'a')), 1);
    assert_eq!(f.installations("voter-001"), [format!("{}c", voter.0)]);
    assert_eq!(f.installations("auditor-001"), [format!("{}a", auditor.0)]);
}

// Verifies: REQ-PSH-003
#[test]
fn a_registration_for_a_session_that_ended_changes_nothing() {
    let f = Fixture::new();
    let live = f.session("voter-001", 1);
    f.register(registration(1, "voter-001", live, 'a'));
    let ended = f.session("voter-001", 2);
    f.sessions.revoke(&[102; 32]).unwrap();
    assert_eq!(f.register(registration(2, "voter-001", ended, 'a')), 0);
    assert_eq!(f.installations("voter-001"), [format!("{}a", live.0)]);
    // Nor may a registration name another user's session.
    assert_eq!(f.register(registration(3, "auditor-001", live, 'b')), 0);
    assert!(f.devices.for_user("auditor-001").unwrap().is_empty());
}

// Verifies: REQ-PSH-004
#[test]
fn only_the_owner_unregisters_an_installation() {
    let f = Fixture::new();
    let mine = registration(1, "voter-001", f.session("voter-001", 1), 'a');
    f.register(mine.clone());
    assert_eq!(
        f.devices.unregister("auditor-001", &mine.installation),
        Ok(false)
    );
    assert_eq!(
        f.devices.unregister("voter-001", &mine.installation),
        Ok(true)
    );
    assert_eq!(
        f.devices.unregister("voter-001", &mine.installation),
        Ok(false)
    );
    assert!(f.devices.for_user("voter-001").unwrap().is_empty());
}

// Verifies: REQ-PSH-005
#[test]
fn a_dead_token_removes_only_the_registration_still_holding_it() {
    let f = Fixture::new();
    let session = f.session("voter-001", 1);
    let old = registration(1, "voter-001", session, 'a');
    f.register(old.clone());
    let renewed = registration(1, "voter-001", session, 'b');
    f.register(renewed.clone());
    assert_eq!(
        f.devices.remove_if_token(&old.installation, &old.token),
        Ok(false)
    );
    assert_eq!(f.installations("voter-001"), [format!("{}b", session.0)]);
    assert_eq!(
        f.devices
            .remove_if_token(&renewed.installation, &renewed.token),
        Ok(true)
    );
    assert_eq!(
        f.devices
            .remove_if_token(&renewed.installation, &renewed.token),
        Ok(false)
    );
}

// Verifies: REQ-PSH-005 REQ-DB-009
#[test]
fn pruning_removes_what_was_refreshed_at_or_before_the_cutoff() {
    let f = Fixture::new();
    let session = f.session("voter-001", 1);
    for (n, at) in [(1, 0), (2, 99), (3, 100)] {
        f.register(Registration {
            refreshed_at: t(at),
            ..registration(n, "voter-001", session, char::from(b'a' + n))
        });
    }
    assert_eq!(f.devices.prune(t(99)), Ok(2));
    assert_eq!(f.installations("voter-001"), [format!("{}d", session.0)]);
    assert_eq!(f.devices.prune(t(99)), Ok(0));
}

// Verifies: REQ-DB-006
#[test]
fn moving_a_token_that_fails_part_way_leaves_it_with_its_owner() {
    let f = Fixture::new();
    let (voter, auditor) = (f.session("voter-001", 1), f.session("auditor-001", 2));
    f.register(registration(1, "voter-001", voter, 'a'));
    // The old holder is deleted before this insert fails.
    exec(
        &f.db,
        "CREATE TEMP TRIGGER injected BEFORE INSERT ON main.device_registrations \
         BEGIN SELECT RAISE(ABORT, 'injected'); END",
    );
    assert_eq!(
        f.devices
            .register(registration(2, "auditor-001", auditor, 'a')),
        Err(StoreError::Failed)
    );
    exec(&f.db, "DROP TRIGGER temp.injected");
    assert_eq!(f.installations("voter-001"), [format!("{}a", voter.0)]);
    assert!(f.devices.for_user("auditor-001").unwrap().is_empty());
}

// Verifies: REQ-DB-008
#[test]
fn a_broken_row_is_a_store_failure_not_a_panic() {
    let f = Fixture::new();
    let session = f.session("voter-001", 1);
    f.register(registration(1, "voter-001", session, 'a'));
    exec(&f.db, "PRAGMA ignore_check_constraints = ON");
    for broken in [
        "locale = x'00'",
        "platform = 'web'",
        "installation_id = 'not-a-uuid'",
        "environment = 'moon'",
        "push_token = 'not hex'",
        "refreshed_at = 9223372036854775807",
    ] {
        exec(
            &f.db,
            &format!("SAVEPOINT s; UPDATE device_registrations SET {broken};"),
        );
        assert_eq!(
            f.devices.for_user("voter-001"),
            Err(StoreError::Failed),
            "{broken}"
        );
        exec(&f.db, "ROLLBACK TO s; RELEASE s;");
    }
    assert_eq!(f.devices.for_user("voter-001").unwrap().len(), 1);
    exec(&f.db, "DROP TABLE device_registrations");
    let gone = registration(2, "voter-001", session, 'b');
    assert_eq!(f.devices.register(gone.clone()), Err(StoreError::Failed));
    assert_eq!(
        f.devices.unregister("voter-001", &gone.installation),
        Err(StoreError::Failed)
    );
    assert_eq!(
        f.devices.remove_if_token(&gone.installation, &gone.token),
        Err(StoreError::Failed)
    );
    assert_eq!(f.devices.prune(t(0)), Err(StoreError::Failed));
}
