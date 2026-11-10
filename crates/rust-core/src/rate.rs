//! Rate limiting policy, route classes and token bucket math (spec 031, ADR-0050).
//!
//! Verifies: REQ-RL-001 REQ-RL-002

use serde::{Deserialize, Serialize};

/// Number of micro-units per whole token. Using 60,000 means that at a rate of
/// `R` tokens per minute (60,000 ms), the refill rate is exactly `R` micro-units per millisecond.
pub const TOKEN_SCALE: u64 = 60_000;

/// A route's rate-limiting class (REQ-RL-001). Every product and health route belongs to one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteClass {
    /// Sign-in, refresh, sign-out and account deletion: tightest limits, counted before authentication.
    Auth,
    /// Operations that change state (e.g. device registrations).
    Write,
    /// Read-only product routes.
    Read,
    /// Health, readiness and configuration routes: exempt from limiting and load shedding.
    Exempt,
}

impl RouteClass {
    pub const ALL: [Self; 4] = [Self::Auth, Self::Write, Self::Read, Self::Exempt];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::Write => "write",
            Self::Read => "read",
            Self::Exempt => "exempt",
        }
    }
}

/// The sustained rate and burst capacity for one route class (REQ-RL-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassPolicy {
    /// Maximum tokens refilled per minute.
    pub sustained_per_minute: u32,
    /// Maximum tokens the bucket can hold at any moment.
    pub burst: u32,
}

impl ClassPolicy {
    pub const fn new(sustained_per_minute: u32, burst: u32) -> Self {
        Self {
            sustained_per_minute,
            burst,
        }
    }

    /// Full burst capacity in internal token scale units.
    pub const fn burst_units(self) -> u64 {
        (self.burst as u64) * TOKEN_SCALE
    }
}

/// The global rate limiting policy (REQ-RL-001, REQ-RL-006, REQ-RL-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RatePolicy {
    pub auth: ClassPolicy,
    pub write: ClassPolicy,
    pub read: ClassPolicy,
    /// Maximum number of distinct caller keys kept in the in-process store (REQ-RL-006).
    pub max_keys: usize,
    /// Maximum number of concurrent in-flight requests before load shedding begins (REQ-RL-007).
    pub max_in_flight: usize,
}

impl RatePolicy {
    /// Gets the class policy for the given route class, if limited.
    pub fn for_class(&self, class: RouteClass) -> Option<ClassPolicy> {
        match class {
            RouteClass::Auth => Some(self.auth),
            RouteClass::Write => Some(self.write),
            RouteClass::Read => Some(self.read),
            RouteClass::Exempt => None,
        }
    }
}

/// The canonical rate limits (REQ-RL-001).
pub const RATE_POLICY: RatePolicy = RatePolicy {
    auth: ClassPolicy::new(10, 5),
    write: ClassPolicy::new(60, 20),
    read: ClassPolicy::new(300, 60),
    max_keys: 10_000,
    max_in_flight: 100,
};

/// A token bucket state for one caller (REQ-RL-002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bucket {
    /// Tokens currently available, measured in units of `TOKEN_SCALE`.
    pub units: u64,
    /// Milliseconds timestamp of the last time this bucket was refilled or touched.
    pub last_refill_at_ms: u64,
}

impl Bucket {
    /// Creates a fresh bucket filled to its burst capacity at the given timestamp.
    pub fn full(policy: &ClassPolicy, now_ms: u64) -> Self {
        Self {
            units: policy.burst_units(),
            last_refill_at_ms: now_ms,
        }
    }

    /// Whether this bucket is at full capacity and has been idle for at least one full refill cycle (REQ-RL-006).
    pub fn is_idle_and_full(&self, policy: &ClassPolicy, now_ms: u64) -> bool {
        if self.units < policy.burst_units() {
            return false;
        }
        let full_refill_ms = if policy.sustained_per_minute > 0 {
            (policy.burst as u64 * 60_000).div_ceil(policy.sustained_per_minute as u64)
        } else {
            60_000
        };
        now_ms.saturating_sub(self.last_refill_at_ms) >= full_refill_ms
    }
}

/// Result of evaluating a request against a token bucket (REQ-RL-002).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TakeResult {
    /// Whether the request is permitted.
    pub allowed: bool,
    /// The updated state of the bucket.
    pub bucket: Bucket,
    /// When limited, the whole seconds until at least one token is available (REQ-RL-004).
    pub retry_after_secs: Option<u64>,
}

/// Pure token bucket decision function (REQ-RL-002).
///
/// Evaluates whether one token can be consumed from `bucket` under `policy` at `now_ms`.
/// If the clock goes backwards, it is treated as no time passing.
pub fn take(bucket: &Bucket, policy: &ClassPolicy, now_ms: u64) -> TakeResult {
    if policy.sustained_per_minute == 0 && policy.burst == 0 {
        return TakeResult {
            allowed: false,
            bucket: *bucket,
            retry_after_secs: Some(60),
        };
    }

    let burst_units = policy.burst_units();
    let (delta_ms, last_refill_at_ms) = if now_ms >= bucket.last_refill_at_ms {
        (now_ms - bucket.last_refill_at_ms, now_ms)
    } else {
        // Clock went backwards: treat as no time elapsed, preserve last refill timestamp.
        (0, bucket.last_refill_at_ms)
    };

    let refill_units = delta_ms.saturating_mul(policy.sustained_per_minute as u64);
    let available_units = bucket.units.saturating_add(refill_units).min(burst_units);

    if available_units >= TOKEN_SCALE {
        TakeResult {
            allowed: true,
            bucket: Bucket {
                units: available_units - TOKEN_SCALE,
                last_refill_at_ms,
            },
            retry_after_secs: None,
        }
    } else {
        let missing_units = TOKEN_SCALE - available_units;
        let rate = policy.sustained_per_minute as u64;
        let time_ms = missing_units.div_ceil(rate);
        let retry_after_secs = time_ms.div_ceil(1000).max(1);

        TakeResult {
            allowed: false,
            bucket: Bucket {
                units: available_units,
                last_refill_at_ms,
            },
            retry_after_secs: Some(retry_after_secs),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_values_match_spec_defaults() {
        // Verifies: REQ-RL-001
        assert_eq!(RATE_POLICY.auth.sustained_per_minute, 10);
        assert_eq!(RATE_POLICY.auth.burst, 5);
        assert_eq!(RATE_POLICY.write.sustained_per_minute, 60);
        assert_eq!(RATE_POLICY.write.burst, 20);
        assert_eq!(RATE_POLICY.read.sustained_per_minute, 300);
        assert_eq!(RATE_POLICY.read.burst, 60);
        assert_eq!(RATE_POLICY.max_keys, 10_000);
        assert_eq!(RATE_POLICY.max_in_flight, 100);

        assert_eq!(
            RATE_POLICY.for_class(RouteClass::Auth),
            Some(RATE_POLICY.auth)
        );
        assert_eq!(
            RATE_POLICY.for_class(RouteClass::Write),
            Some(RATE_POLICY.write)
        );
        assert_eq!(
            RATE_POLICY.for_class(RouteClass::Read),
            Some(RATE_POLICY.read)
        );
        assert_eq!(RATE_POLICY.for_class(RouteClass::Exempt), None);
    }

    #[test]
    fn route_class_strings_and_all() {
        assert_eq!(RouteClass::ALL.len(), 4);
        assert_eq!(RouteClass::Auth.as_str(), "auth");
        assert_eq!(RouteClass::Write.as_str(), "write");
        assert_eq!(RouteClass::Read.as_str(), "read");
        assert_eq!(RouteClass::Exempt.as_str(), "exempt");
    }

    #[test]
    fn zero_policy_rejects() {
        let policy = ClassPolicy::new(0, 0);
        let bucket = Bucket::full(&policy, 0);
        let res = take(&bucket, &policy, 1000);
        assert!(!res.allowed);
        assert_eq!(res.retry_after_secs, Some(60));
    }

    #[test]
    fn idle_and_full_detection() {
        let policy = ClassPolicy::new(10, 5);
        let bucket = Bucket::full(&policy, 0);
        // At 0 ms it is full, but hasn't been idle for a full refill period (30s)
        assert!(!bucket.is_idle_and_full(&policy, 10_000));
        assert!(bucket.is_idle_and_full(&policy, 30_000));

        let partial = Bucket {
            units: 100,
            last_refill_at_ms: 0,
        };
        assert!(!partial.is_idle_and_full(&policy, 60_000));

        let zero_rate_policy = ClassPolicy::new(0, 5);
        let zero_bucket = Bucket::full(&zero_rate_policy, 0);
        assert!(zero_bucket.is_idle_and_full(&zero_rate_policy, 60_000));
    }
}
