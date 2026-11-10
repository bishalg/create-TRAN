//! The sample's device registry: in memory, empty after a restart, like the session store
//! (ADR-0044). One lock covers every table, so each operation is atomic, which is what
//! [`DeviceStore`] asks of a fork's database.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use chrono::{DateTime, Utc};

use crate::devices::{DeviceStore, InstallationId, PushToken, Registration};
use crate::session_store::SessionId;

#[derive(Debug, Default)]
pub struct InMemoryDeviceStore(Mutex<HashMap<InstallationId, Registration>>);

impl InMemoryDeviceStore {
    fn table(&self) -> MutexGuard<'_, HashMap<InstallationId, Registration>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Removes every registration `remove` picks; returns how many.
    fn remove_where(&self, mut remove: impl FnMut(&Registration) -> bool) -> usize {
        let mut table = self.table();
        let before = table.len();
        table.retain(|_, registration| !remove(registration));
        before - table.len()
    }
}

impl DeviceStore for InMemoryDeviceStore {
    fn register(&self, registration: Registration) -> usize {
        let mut table = self.table();
        let before = table.len();
        table.retain(|installation, other| {
            installation == &registration.installation || other.token != registration.token
        });
        let displaced = before - table.len();
        table.insert(registration.installation.clone(), registration);
        displaced
    }

    fn unregister(&self, user_id: &str, installation: &InstallationId) -> bool {
        let mut table = self.table();
        let owned = table
            .get(installation)
            .is_some_and(|registration| registration.user_id == user_id);
        owned && table.remove(installation).is_some()
    }

    fn remove_session(&self, session: SessionId) -> usize {
        self.remove_where(|registration| registration.session == session)
    }

    fn remove_user(&self, user_id: &str) -> usize {
        self.remove_where(|registration| registration.user_id == user_id)
    }

    fn remove_if_token(&self, installation: &InstallationId, token: &PushToken) -> bool {
        let mut table = self.table();
        let current = table
            .get(installation)
            .is_some_and(|registration| &registration.token == token);
        current && table.remove(installation).is_some()
    }

    fn for_user(&self, user_id: &str) -> Vec<Registration> {
        self.table()
            .values()
            .filter(|registration| registration.user_id == user_id)
            .cloned()
            .collect()
    }

    fn prune(&self, cutoff: DateTime<Utc>) -> usize {
        self.remove_where(|registration| registration.refreshed_at <= cutoff)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::devices::{DevicePlatform, PushEnvironment};
    use chrono::Duration;

    pub(crate) fn t(seconds: i64) -> DateTime<Utc> {
        DateTime::<Utc>::UNIX_EPOCH + Duration::seconds(seconds)
    }

    /// Installation `n` (1–9) of `user_id`, made in session `session`, holding token `token`.
    pub(crate) fn registration(n: u8, user_id: &str, session: u64, token: char) -> Registration {
        Registration {
            installation: InstallationId::parse(&format!("2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6{n}"))
                .unwrap(),
            user_id: user_id.into(),
            session: SessionId(session),
            platform: DevicePlatform::Ios,
            environment: PushEnvironment::Production,
            token: PushToken::parse(DevicePlatform::Ios, &token.to_string().repeat(64)).unwrap(),
            locale: "en".into(),
            app_version: "1.0.0".into(),
            marketing: false,
            refreshed_at: t(0),
        }
    }

    fn installations(store: &InMemoryDeviceStore, user_id: &str) -> Vec<String> {
        let mut found: Vec<String> = store
            .for_user(user_id)
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

    // Verifies: REQ-PSH-001
    #[test]
    fn registering_again_replaces_the_installations_registration() {
        let store = InMemoryDeviceStore::default();
        assert_eq!(store.register(registration(1, "voter-001", 1, 'a')), 0);
        let refreshed = Registration {
            refreshed_at: t(60),
            ..registration(1, "voter-001", 2, 'b')
        };
        assert_eq!(store.register(refreshed.clone()), 0);
        assert_eq!(store.for_user("voter-001"), [refreshed]);
    }

    // Verifies: REQ-PSH-002
    #[test]
    fn a_token_moves_to_its_newest_owner() {
        let store = InMemoryDeviceStore::default();
        store.register(registration(1, "voter-001", 1, 'a'));
        store.register(registration(2, "voter-001", 1, 'c'));
        assert_eq!(store.register(registration(3, "auditor-001", 2, 'a')), 1);
        assert_eq!(installations(&store, "voter-001"), ["1c"]);
        assert_eq!(installations(&store, "auditor-001"), ["2a"]);
    }

    // Verifies: REQ-PSH-004
    #[test]
    fn only_the_owner_unregisters_an_installation() {
        let store = InMemoryDeviceStore::default();
        let mine = registration(1, "voter-001", 1, 'a');
        store.register(mine.clone());
        assert!(!store.unregister("auditor-001", &mine.installation));
        assert!(store.unregister("voter-001", &mine.installation));
        assert!(!store.unregister("voter-001", &mine.installation));
        assert!(store.for_user("voter-001").is_empty());
    }

    // Verifies: REQ-PSH-003
    #[test]
    fn a_session_or_a_user_takes_its_registrations_with_it() {
        let store = InMemoryDeviceStore::default();
        store.register(registration(1, "voter-001", 1, 'a'));
        store.register(registration(2, "voter-001", 1, 'b'));
        store.register(registration(3, "voter-001", 2, 'c'));
        store.register(registration(4, "auditor-001", 3, 'd'));
        assert_eq!(store.remove_session(SessionId(1)), 2);
        assert_eq!(store.remove_session(SessionId(1)), 0);
        assert_eq!(installations(&store, "voter-001"), ["2c"]);
        assert_eq!(store.remove_user("voter-001"), 1);
        assert_eq!(installations(&store, "auditor-001"), ["3d"]);
    }

    // Verifies: REQ-PSH-005
    #[test]
    fn a_dead_token_removes_only_the_registration_still_holding_it() {
        let store = InMemoryDeviceStore::default();
        let old = registration(1, "voter-001", 1, 'a');
        store.register(old.clone());
        let renewed = registration(1, "voter-001", 1, 'b');
        store.register(renewed.clone());
        assert!(!store.remove_if_token(&old.installation, &old.token));
        assert_eq!(installations(&store, "voter-001"), ["1b"]);
        assert!(store.remove_if_token(&renewed.installation, &renewed.token));
        assert!(!store.remove_if_token(&renewed.installation, &renewed.token));
    }

    // Verifies: REQ-PSH-005
    #[test]
    fn pruning_removes_what_was_refreshed_at_or_before_the_cutoff() {
        let store = InMemoryDeviceStore::default();
        for (n, at) in [(1, 0), (2, 99), (3, 100)] {
            store.register(Registration {
                refreshed_at: t(at),
                ..registration(n, "voter-001", 1, char::from(b'a' + n))
            });
        }
        assert_eq!(store.prune(t(99)), 2);
        assert_eq!(installations(&store, "voter-001"), ["1d"]);
        assert_eq!(store.prune(t(99)), 0);
    }
}
