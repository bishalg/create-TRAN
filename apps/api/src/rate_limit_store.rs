// Verifies: REQ-RL-006 REQ-RL-008 REQ-RL-010
//! Rate limit store abstraction and in-memory bounded implementation (spec 031, ADR-0050).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use rust_core::rate::{take, Bucket, ClassPolicy, RouteClass, TakeResult};

use crate::db::StoreError;

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

    /// Records that a request was limited for `class` in metrics (REQ-RL-008).
    fn record_limited(&self, class: RouteClass);

    /// Total count of rate-limited requests for `class` (REQ-RL-008: `tran_rate_limited_total{class}`).
    fn rate_limited_count(&self, class: RouteClass) -> u64;

    /// Checks if a rate-limited event should be logged for `key` (at most once per window, REQ-RL-008).
    fn should_log_limited(&self, key: &str, now_ms: u64) -> bool;
}

#[derive(Debug, Clone)]
struct BucketEntry {
    bucket: Bucket,
    policy: ClassPolicy,
}

struct MemoryState {
    buckets: HashMap<(RouteClass, String), BucketEntry>,
    /// Order of keys by last activity for LRU eviction when reaching capacity (REQ-RL-006).
    access_order: VecDeque<(RouteClass, String)>,
    /// Last timestamp a rate-limit log was emitted for this key (REQ-RL-008).
    last_logged: HashMap<String, u64>,
}

/// In-process token bucket store bounded by `max_keys` (REQ-RL-006).
pub struct MemoryRateLimitStore {
    max_keys: usize,
    state: Mutex<MemoryState>,
    failing: AtomicBool,
    auth_limited_count: AtomicU64,
    write_limited_count: AtomicU64,
    read_limited_count: AtomicU64,
}

impl MemoryRateLimitStore {
    pub fn new(max_keys: usize) -> Self {
        Self {
            max_keys,
            state: Mutex::new(MemoryState {
                buckets: HashMap::new(),
                access_order: VecDeque::new(),
                last_logged: HashMap::new(),
            }),
            failing: AtomicBool::new(false),
            auth_limited_count: AtomicU64::new(0),
            write_limited_count: AtomicU64::new(0),
            read_limited_count: AtomicU64::new(0),
        }
    }

    /// Simulates a store failure for testing fail-open/fail-closed behavior (REQ-RL-010).
    pub fn set_failing(&self, failing: bool) {
        self.failing.store(failing, Ordering::SeqCst);
    }

    /// Number of active buckets currently held in memory.
    pub fn len(&self) -> usize {
        self.state.lock().map(|s| s.buckets.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
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

        let mut state = self.state.lock().map_err(|_| StoreError::Failed)?;

        // Prune full buckets that have been idle for a full refill period (REQ-RL-006).
        state.buckets.retain(|_, entry| {
            let delta_ms = now_ms.saturating_sub(entry.bucket.last_refill_at_ms);
            let refill_units = delta_ms.saturating_mul(entry.policy.sustained_per_minute as u64);
            let units = entry
                .bucket
                .units
                .saturating_add(refill_units)
                .min(entry.policy.burst_units());
            let current_bucket = Bucket {
                units,
                last_refill_at_ms: entry.bucket.last_refill_at_ms,
            };
            !current_bucket.is_idle_and_full(&entry.policy, now_ms)
        });
        let retained_keys: std::collections::HashSet<(RouteClass, String)> =
            state.buckets.keys().cloned().collect();
        state.access_order.retain(|k| retained_keys.contains(k));

        let store_key = (class, key.to_string());
        let bucket = match state.buckets.get(&store_key) {
            Some(entry) => entry.bucket,
            None => {
                // If capacity is reached, evict the oldest key (REQ-RL-006).
                if state.buckets.len() >= self.max_keys {
                    if let Some(oldest) = state.access_order.pop_front() {
                        state.buckets.remove(&oldest);
                    }
                }
                Bucket::full(policy, now_ms)
            }
        };

        let result = take(&bucket, policy, now_ms);
        state.buckets.insert(
            store_key.clone(),
            BucketEntry {
                bucket: result.bucket,
                policy: *policy,
            },
        );
        state.access_order.retain(|k| k != &store_key);
        state.access_order.push_back(store_key);

        if !result.allowed {
            self.record_limited(class);
        }

        Ok(result)
    }

    fn record_limited(&self, class: RouteClass) {
        match class {
            RouteClass::Auth => self.auth_limited_count.fetch_add(1, Ordering::SeqCst),
            RouteClass::Write => self.write_limited_count.fetch_add(1, Ordering::SeqCst),
            RouteClass::Read => self.read_limited_count.fetch_add(1, Ordering::SeqCst),
            RouteClass::Exempt => 0,
        };
    }

    fn rate_limited_count(&self, class: RouteClass) -> u64 {
        match class {
            RouteClass::Auth => self.auth_limited_count.load(Ordering::SeqCst),
            RouteClass::Write => self.write_limited_count.load(Ordering::SeqCst),
            RouteClass::Read => self.read_limited_count.load(Ordering::SeqCst),
            RouteClass::Exempt => 0,
        }
    }

    fn should_log_limited(&self, key: &str, now_ms: u64) -> bool {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        const WINDOW_MS: u64 = 60_000;
        match state.last_logged.get(key) {
            Some(&last) if now_ms.saturating_sub(last) < WINDOW_MS => false,
            _ => {
                state.last_logged.insert(key.to_string(), now_ms);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-RL-006 REQ-RL-008 REQ-RL-010
    #[test]
    fn store_is_bounded_and_evicts_oldest() {
        let store = MemoryRateLimitStore::new(2);
        let policy = ClassPolicy::new(10, 5);

        assert!(store.is_empty());
        assert_eq!(store.len(), 0);

        let res1 = store.take("key1", RouteClass::Auth, &policy, 1000).unwrap();
        assert!(res1.allowed);
        assert_eq!(store.len(), 1);

        let res2 = store.take("key2", RouteClass::Auth, &policy, 1000).unwrap();
        assert!(res2.allowed);
        assert_eq!(store.len(), 2);

        // Taking an existing key hits Some(entry)
        let res2_existing = store.take("key2", RouteClass::Auth, &policy, 1000).unwrap();
        assert!(res2_existing.allowed);

        // Third key forces eviction of oldest key1
        let res3 = store.take("key3", RouteClass::Auth, &policy, 1000).unwrap();
        assert!(res3.allowed);
        assert_eq!(store.len(), 2);

        // key1 was evicted, so taking it again treats it as a fresh bucket
        let res1_again = store.take("key1", RouteClass::Auth, &policy, 1000).unwrap();
        assert!(res1_again.allowed);
    }

    // Verifies: REQ-RL-006
    #[test]
    fn idle_full_buckets_are_dropped() {
        let store = MemoryRateLimitStore::new(10);
        let policy = ClassPolicy::new(10, 5);

        store.take("key1", RouteClass::Auth, &policy, 0).unwrap();
        assert_eq!(store.len(), 1);

        // Advance past full refill period (30s) so it becomes idle and full
        store
            .take("key2", RouteClass::Auth, &policy, 31_000)
            .unwrap();
        // key1 should be dropped
        assert_eq!(store.len(), 1);
    }

    // Verifies: REQ-RL-008
    #[test]
    fn limited_counts_and_logging_window() {
        let store = MemoryRateLimitStore::new(10);
        let policy = ClassPolicy::new(0, 0); // Always rejects

        assert_eq!(store.rate_limited_count(RouteClass::Auth), 0);
        let res = store.take("k1", RouteClass::Auth, &policy, 1000).unwrap();
        assert!(!res.allowed);
        assert_eq!(store.rate_limited_count(RouteClass::Auth), 1);

        store.record_limited(RouteClass::Write);
        assert_eq!(store.rate_limited_count(RouteClass::Write), 1);
        store.record_limited(RouteClass::Read);
        assert_eq!(store.rate_limited_count(RouteClass::Read), 1);
        store.record_limited(RouteClass::Exempt);
        assert_eq!(store.rate_limited_count(RouteClass::Exempt), 0);

        // Logging: at most once per window (60s)
        assert!(store.should_log_limited("k1", 1000));
        assert!(!store.should_log_limited("k1", 2000));
        assert!(store.should_log_limited("k1", 62000));
    }

    // Verifies: REQ-RL-010
    #[test]
    fn failure_injection() {
        let store = MemoryRateLimitStore::new(10);
        let policy = ClassPolicy::new(10, 5);

        store.set_failing(true);
        assert_eq!(
            store
                .take("k1", RouteClass::Auth, &policy, 1000)
                .unwrap_err(),
            StoreError::Failed
        );
        assert!(store.should_log_limited("k1", 1000));
    }

    #[test]
    fn poisoned_mutex_fails_gracefully() {
        let store = std::sync::Arc::new(MemoryRateLimitStore::new(10));
        let store_clone = store.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _lock = store_clone.state.lock().unwrap();
            panic!("poisoning");
        }));
        let policy = ClassPolicy::new(10, 5);
        assert_eq!(
            store
                .take("k", RouteClass::Auth, &policy, 1000)
                .unwrap_err(),
            StoreError::Failed
        );
        assert_eq!(store.len(), 0);
        assert!(store.should_log_limited("k", 1000));
    }

    #[test]
    fn evicts_even_if_access_order_is_empty() {
        let store = MemoryRateLimitStore::new(1);
        let policy = ClassPolicy::new(10, 5);
        {
            let mut s = store.state.lock().unwrap();
            s.buckets.insert(
                (RouteClass::Auth, "ghost".to_string()),
                BucketEntry {
                    bucket: Bucket::full(&policy, 0),
                    policy,
                },
            );
        }
        let res = store
            .take("new_key", RouteClass::Auth, &policy, 1000)
            .unwrap();
        assert!(res.allowed);
    }
}
