// Verifies: REQ-RL-003 REQ-RL-004
//! Which user an access token belongs to, as far as the limiter needs to know (spec 031).
//!
//! The limiter counts a signed-in request by its user (REQ-RL-003) but must decide before the
//! session store is touched (REQ-RL-004). So the API remembers, in memory, the user of every access
//! token it issues or authenticates, for at most the token's lifetime. A token it does not know (a
//! forged one, or one issued by another process) is counted by address until a handler
//! authenticates it. The entry only chooses a bucket: authorisation always asks the store.
//!
//! Bounded like the buckets: at most `max_keys` entries, oldest first out, `O(1)` amortised.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard, PoisonError};

use rust_core::session::SESSION_POLICY;

use crate::session_store::TokenDigest;

#[derive(Default)]
struct Known {
    users: HashMap<TokenDigest, (String, u64)>,
    /// Digests in insertion order; with one lifetime for all, that is expiry order too.
    order: VecDeque<(u64, TokenDigest)>,
}

/// Access-token digest to user id, for choosing a rate limit key.
pub struct SignedInKeys {
    max_keys: usize,
    ttl_ms: u64,
    known: Mutex<Known>,
}

impl SignedInKeys {
    /// Remembers at most `max_keys` tokens for one access-token lifetime each.
    pub fn new(max_keys: usize) -> Self {
        Self {
            max_keys: max_keys.max(1),
            ttl_ms: SESSION_POLICY.access_ttl_seconds.saturating_mul(1000),
            known: Mutex::new(Known::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Known> {
        self.known.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Notes that `access` belongs to `user_id`, seen at `now_ms`. A token already known keeps its
    /// first expiry, which is never later than the token's own.
    pub fn remember(&self, access: &TokenDigest, user_id: &str, now_ms: u64) {
        let mut guard = self.lock();
        let known = &mut *guard;
        Self::forget_expired(known, now_ms);
        if known.users.contains_key(access) {
            return;
        }
        // `order` and `users` hold the same digests, so this drains only what is there.
        let excess = (known.order.len() + 1).saturating_sub(self.max_keys);
        for (_, oldest) in known.order.drain(..excess) {
            known.users.remove(&oldest);
        }
        let expires_at = now_ms.saturating_add(self.ttl_ms);
        known
            .users
            .insert(*access, (user_id.to_owned(), expires_at));
        known.order.push_back((expires_at, *access));
    }

    /// The user of `access`, if this process issued or authenticated it within its lifetime.
    pub fn user(&self, access: &TokenDigest, now_ms: u64) -> Option<String> {
        let mut known = self.lock();
        Self::forget_expired(&mut known, now_ms);
        known.users.get(access).map(|(user, _)| user.clone())
    }

    /// How many tokens are remembered.
    pub fn len(&self) -> usize {
        self.lock().users.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn forget_expired(known: &mut Known, now_ms: u64) {
        let expired = known
            .order
            .partition_point(|(expires_at, _)| *expires_at <= now_ms);
        for (_, digest) in known.order.drain(..expired) {
            known.users.remove(&digest);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(n: u8) -> TokenDigest {
        [n; 32]
    }

    // Verifies: REQ-RL-003
    #[test]
    fn a_remembered_token_names_its_user_until_it_expires() {
        let keys = SignedInKeys::new(10);
        assert!(keys.is_empty());
        assert_eq!(keys.user(&digest(1), 0), None);
        keys.remember(&digest(1), "voter-001", 0);
        keys.remember(&digest(1), "voter-001", 5_000);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys.user(&digest(1), 1).as_deref(), Some("voter-001"));
        let ttl = SESSION_POLICY.access_ttl_seconds * 1000;
        assert_eq!(keys.user(&digest(1), ttl - 1).as_deref(), Some("voter-001"));
        assert_eq!(keys.user(&digest(1), ttl), None);
        assert!(keys.is_empty());
    }

    // Verifies: REQ-RL-006
    #[test]
    fn the_map_is_bounded_and_forgets_the_oldest_first() {
        let keys = SignedInKeys::new(3);
        for n in 0..50 {
            keys.remember(&digest(n), "user", u64::from(n));
            assert!(keys.len() <= 3);
        }
        assert_eq!(keys.user(&digest(46), 50), None);
        assert_eq!(keys.user(&digest(49), 50).as_deref(), Some("user"));
    }

    #[test]
    fn a_poisoned_lock_is_recovered() {
        let keys = std::sync::Arc::new(SignedInKeys::new(3));
        let poisoner = keys.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _lock = poisoner.known.lock().unwrap();
            panic!("poisoning");
        }));
        keys.remember(&digest(1), "user", 0);
        assert_eq!(keys.user(&digest(1), 0).as_deref(), Some("user"));
    }
}
