// Verifies: REQ-RL-006 REQ-RL-008 REQ-RL-010
//! Rate limit store abstraction and in-memory bounded implementation (spec 031, ADR-0050).
//!
//! [`MemoryRateLimitStore`] keeps at most `max_keys` buckets. Each take does `O(log n)` work: two
//! ordered indexes say which bucket was used least recently (evicted when full) and which become
//! droppable soonest (pruned once idle for a whole refill period). Nothing is rebuilt per request,
//! and the "logged at" stamp of REQ-RL-008 lives in the bucket's entry, so it is evicted with it.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use rust_core::rate::{take, Bucket, ClassPolicy, RouteClass, TakeResult};

use crate::db::StoreError;

/// How long one key's "rate limited" log stays quiet after it is written (REQ-RL-008).
pub const LOG_WINDOW_MS: u64 = 60_000;

/// Storage interface for token buckets (REQ-RL-006).
pub trait RateLimitStore: Send + Sync {
    /// Attempts to consume one token for `key` in `class` according to `policy` at `now_ms`.
    fn take(
        &self,
        key: &str,
        class: RouteClass,
        policy: &ClassPolicy,
        now_ms: u64,
    ) -> Result<TakeResult, StoreError>;

    /// Whether a limited answer for `key` may be logged now: at most once per [`LOG_WINDOW_MS`]
    /// per key (REQ-RL-008). It must never grow the store.
    fn should_log_limited(&self, key: &str, class: RouteClass, now_ms: u64) -> bool;
}

type Key = (RouteClass, String);

#[derive(Debug, Clone, Copy)]
struct Entry {
    bucket: Bucket,
    /// Position in the recency index; also breaks ties in the drop index.
    seq: u64,
    droppable_at_ms: u64,
    logged_at_ms: Option<u64>,
}

#[derive(Default)]
struct MemoryState {
    entries: HashMap<Key, Entry>,
    /// Least recently used first: the eviction order when the store is full.
    by_recency: BTreeMap<u64, Key>,
    /// Soonest droppable first: the pruning order.
    by_drop: BTreeMap<(u64, u64), Key>,
    next_seq: u64,
}

impl MemoryState {
    fn remove(&mut self, key: &Key) -> Option<Entry> {
        let entry = self.entries.remove(key)?;
        self.by_recency.remove(&entry.seq);
        self.by_drop.remove(&(entry.droppable_at_ms, entry.seq));
        Some(entry)
    }

    fn insert(&mut self, key: Key, mut entry: Entry) {
        entry.seq = self.next_seq;
        self.next_seq += 1;
        self.by_recency.insert(entry.seq, key.clone());
        self.by_drop
            .insert((entry.droppable_at_ms, entry.seq), key.clone());
        self.entries.insert(key, entry);
    }

    /// Drops every bucket idle for a whole refill period (REQ-RL-006); each is removed once.
    fn prune(&mut self, now_ms: u64) {
        while let Some(entry) = self
            .by_drop
            .first_entry()
            .filter(|entry| entry.key().0 <= now_ms)
        {
            let key = entry.remove();
            self.remove(&key);
        }
    }

    /// Evicts the bucket used least recently.
    fn evict_oldest(&mut self) {
        let oldest = self.by_recency.pop_first();
        oldest.into_iter().for_each(|(_, key)| {
            self.remove(&key);
        });
    }
}

/// In-process token bucket store bounded by `max_keys` (REQ-RL-006).
pub struct MemoryRateLimitStore {
    max_keys: usize,
    state: Mutex<MemoryState>,
    failing: AtomicBool,
}

impl MemoryRateLimitStore {
    pub fn new(max_keys: usize) -> Self {
        Self {
            max_keys,
            state: Mutex::new(MemoryState::default()),
            failing: AtomicBool::new(false),
        }
    }

    /// Simulates a store failure for testing fail-open/fail-closed behavior (REQ-RL-010).
    pub fn set_failing(&self, failing: bool) {
        self.failing.store(failing, Ordering::SeqCst);
    }

    /// Number of active buckets currently held in memory.
    pub fn len(&self) -> usize {
        self.lock().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The lock, recovered if a panic poisoned it: no code under the lock leaves the indexes
    /// half-updated on a panic it can raise, so the state is still consistent.
    fn lock(&self) -> MutexGuard<'_, MemoryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl RateLimitStore for MemoryRateLimitStore {
    fn take(
        &self,
        key: &str,
        class: RouteClass,
        policy: &ClassPolicy,
        now_ms: u64,
    ) -> Result<TakeResult, StoreError> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(StoreError::Failed);
        }
        let mut state = self.lock();
        state.prune(now_ms);

        let key = (class, key.to_owned());
        let (bucket, logged_at_ms) = match state.remove(&key) {
            Some(entry) => (entry.bucket, entry.logged_at_ms),
            None => {
                while state.entries.len() >= self.max_keys.max(1) {
                    state.evict_oldest();
                }
                (Bucket::full(policy, now_ms), None)
            }
        };

        let result = take(&bucket, policy, now_ms);
        let entry = Entry {
            bucket: result.bucket,
            seq: 0,
            droppable_at_ms: result.bucket.droppable_at_ms(policy),
            logged_at_ms,
        };
        state.insert(key, entry);
        Ok(result)
    }

    fn should_log_limited(&self, key: &str, class: RouteClass, now_ms: u64) -> bool {
        let mut state = self.lock();
        let Some(entry) = state.entries.get_mut(&(class, key.to_owned())) else {
            return true;
        };
        match entry.logged_at_ms {
            Some(last) if now_ms.saturating_sub(last) < LOG_WINDOW_MS => false,
            _ => {
                entry.logged_at_ms = Some(now_ms);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn class(sustained: u32, burst: u32) -> ClassPolicy {
        ClassPolicy::new(sustained, burst).unwrap()
    }

    fn allowed(store: &MemoryRateLimitStore, key: &str, policy: &ClassPolicy, now: u64) -> bool {
        store
            .take(key, RouteClass::Read, policy, now)
            .unwrap()
            .allowed
    }

    // Verifies: REQ-RL-006
    #[test]
    fn the_store_never_holds_more_than_max_keys() {
        let store = MemoryRateLimitStore::new(10);
        let policy = class(1, 1);
        assert!(store.is_empty());
        for i in 0..1_000 {
            store
                .take(&format!("flood-{i}"), RouteClass::Read, &policy, 1_000)
                .unwrap();
            assert!(store.len() <= 10);
            assert_eq!(store.len(), (i + 1).min(10));
        }
        assert_eq!(store.len(), 10);
        let state = store.lock();
        assert_eq!(state.by_recency.len(), 10);
        assert_eq!(state.by_drop.len(), 10);
    }

    // Verifies: REQ-RL-006
    #[test]
    fn a_full_store_evicts_the_bucket_used_least_recently() {
        let store = MemoryRateLimitStore::new(2);
        let policy = class(1, 1);
        assert!(allowed(&store, "a", &policy, 0));
        assert!(allowed(&store, "b", &policy, 0));
        // Touching `a` (limited) makes `b` the least recently used.
        assert!(!allowed(&store, "a", &policy, 0));
        assert!(allowed(&store, "c", &policy, 0));
        assert_eq!(store.len(), 2);
        // `a` kept its empty bucket; `b` was evicted and starts full.
        assert!(!allowed(&store, "a", &policy, 0));
        assert!(allowed(&store, "b", &policy, 0));
    }

    // Verifies: REQ-RL-006
    #[test]
    fn a_bucket_idle_for_a_whole_refill_period_is_dropped() {
        let store = MemoryRateLimitStore::new(10);
        let policy = class(10, 5); // refills completely in 30 s
        store.take("key1", RouteClass::Auth, &policy, 0).unwrap();
        store
            .take("key2", RouteClass::Auth, &policy, 20_000)
            .unwrap();
        store
            .take("key3", RouteClass::Auth, &policy, 29_999)
            .unwrap();
        assert_eq!(store.len(), 3);
        store
            .take("key3", RouteClass::Auth, &policy, 30_000)
            .unwrap();
        assert_eq!(store.len(), 2, "key1 idle for 30 s is dropped");
        // A clock that goes backwards prunes nothing.
        store.take("key3", RouteClass::Auth, &policy, 1).unwrap();
        assert_eq!(store.len(), 2);
    }

    // Verifies: REQ-RL-008
    #[test]
    fn a_limited_key_is_logged_once_per_window_and_the_stamp_is_evicted_with_it() {
        let store = MemoryRateLimitStore::new(1);
        let policy = class(1, 1);
        store.take("k1", RouteClass::Auth, &policy, 1_000).unwrap();
        assert!(store.should_log_limited("k1", RouteClass::Auth, 1_000));
        assert!(!store.should_log_limited("k1", RouteClass::Auth, 2_000));
        // A take keeps the stamp.
        store.take("k1", RouteClass::Auth, &policy, 30_000).unwrap();
        assert!(!store.should_log_limited("k1", RouteClass::Auth, 30_000));
        assert!(store.should_log_limited("k1", RouteClass::Auth, 61_000));
        // The stamp lives in the bucket: an unknown key is answered without being stored.
        assert!(store.should_log_limited("ghost", RouteClass::Auth, 61_000));
        assert!(store.should_log_limited("ghost", RouteClass::Auth, 61_000));
        assert_eq!(store.len(), 1);
        // Evicted with its bucket: a new bucket for the key logs again.
        store
            .take("other", RouteClass::Auth, &policy, 61_000)
            .unwrap();
        store.take("k1", RouteClass::Auth, &policy, 61_000).unwrap();
        assert!(store.should_log_limited("k1", RouteClass::Auth, 61_000));
    }

    // Verifies: REQ-RL-010
    #[test]
    fn failure_injection() {
        let store = MemoryRateLimitStore::new(10);
        store.set_failing(true);
        assert_eq!(
            store
                .take("k1", RouteClass::Auth, &class(10, 5), 1000)
                .unwrap_err(),
            StoreError::Failed
        );
        store.set_failing(false);
        assert!(store
            .take("k1", RouteClass::Auth, &class(10, 5), 1000)
            .is_ok());
    }

    // Verifies: REQ-RL-010
    #[test]
    fn a_poisoned_lock_is_recovered_instead_of_failing_forever() {
        let store = std::sync::Arc::new(MemoryRateLimitStore::new(10));
        let policy = class(10, 5);
        store.take("k", RouteClass::Auth, &policy, 0).unwrap();
        let poisoner = store.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _lock = poisoner.state.lock().unwrap();
            panic!("poisoning");
        }));
        assert!(store.state.is_poisoned());
        let result = store.take("k", RouteClass::Auth, &policy, 0).unwrap();
        assert!(result.allowed);
        assert_eq!(result.bucket.units, 3 * rust_core::rate::TOKEN_SCALE);
        assert_eq!(store.len(), 1);
        assert!(store.should_log_limited("k", RouteClass::Auth, 0));
    }
}
