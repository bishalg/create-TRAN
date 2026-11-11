//! Rate limiting policy, route classes and token bucket math (spec 031, ADR-0050).
//!
//! Verifies: REQ-RL-001 REQ-RL-002

use std::num::NonZeroU32;

use serde::{Deserialize, Serialize};

/// Number of micro-units per whole token. Using 60,000 means that at a rate of
/// `R` tokens per minute (60,000 ms), the refill rate is exactly `R` micro-units per millisecond.
pub const TOKEN_SCALE: u64 = 60_000;

/// A route's rate-limiting class (REQ-RL-001). Every product and health route belongs to one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteClass {
    /// Sign-in, refresh, sign-out and account deletion: tightest limits, counted before authentication.
    Auth,
    /// Operations that change state (e.g. device registrations).
    Write,
    /// Read-only product routes, including the configuration route.
    Read,
    /// Health and readiness probes: exempt from limiting and load shedding.
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
///
/// Both numbers are non-zero by type, so [`take`] is total: a policy that could never refill or
/// never hold a token cannot be built, by configuration or by deserialisation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassPolicy {
    /// Tokens refilled per minute.
    pub sustained_per_minute: NonZeroU32,
    /// Maximum tokens the bucket can hold at any moment.
    pub burst: NonZeroU32,
}

impl ClassPolicy {
    /// A policy, or `None` when either number is zero.
    pub const fn new(sustained_per_minute: u32, burst: u32) -> Option<Self> {
        match (
            NonZeroU32::new(sustained_per_minute),
            NonZeroU32::new(burst),
        ) {
            (Some(sustained_per_minute), Some(burst)) => Some(Self {
                sustained_per_minute,
                burst,
            }),
            _ => None,
        }
    }

    /// Full burst capacity in internal token scale units.
    pub const fn burst_units(self) -> u64 {
        (self.burst.get() as u64) * TOKEN_SCALE
    }

    /// Refill in units per millisecond: `sustained_per_minute`, by the choice of [`TOKEN_SCALE`].
    const fn units_per_ms(self) -> u64 {
        self.sustained_per_minute.get() as u64
    }

    /// Milliseconds an empty bucket takes to refill completely: after this long untouched, any
    /// bucket is full again (REQ-RL-006).
    pub const fn full_refill_ms(self) -> u64 {
        self.burst_units().div_ceil(self.units_per_ms())
    }
}

/// A policy constant from numbers known to be non-zero.
const fn policy(sustained_per_minute: u32, burst: u32) -> ClassPolicy {
    match ClassPolicy::new(sustained_per_minute, burst) {
        Some(policy) => policy,
        None => panic!("a class policy needs a non-zero rate and burst"),
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
    auth: policy(10, 5),
    write: policy(60, 20),
    read: policy(300, 60),
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

    /// Whether this bucket has been idle for at least one full refill period, and so is full
    /// whatever it held (REQ-RL-006).
    pub fn is_idle_and_full(&self, policy: &ClassPolicy, now_ms: u64) -> bool {
        now_ms >= self.droppable_at_ms(policy)
    }

    /// When this bucket, left untouched, may be dropped: one full refill period after it was last
    /// touched, by which time it is full whatever it held (REQ-RL-006).
    pub fn droppable_at_ms(&self, policy: &ClassPolicy) -> u64 {
        self.last_refill_at_ms
            .saturating_add(policy.full_refill_ms())
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

/// Pure token bucket decision function (REQ-RL-002). Total: it answers for every bucket, policy
/// and time without panicking.
///
/// Evaluates whether one token can be consumed from `bucket` under `policy` at `now_ms`.
/// If the clock goes backwards, it is treated as no time passing.
pub fn take(bucket: &Bucket, policy: &ClassPolicy, now_ms: u64) -> TakeResult {
    let burst_units = policy.burst_units();
    let (delta_ms, last_refill_at_ms) = if now_ms >= bucket.last_refill_at_ms {
        (now_ms - bucket.last_refill_at_ms, now_ms)
    } else {
        // Clock went backwards: treat as no time elapsed, preserve last refill timestamp.
        (0, bucket.last_refill_at_ms)
    };

    let refill_units = delta_ms.saturating_mul(policy.units_per_ms());
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
        let time_ms = missing_units.div_ceil(policy.units_per_ms());
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

    fn class(sustained: u32, burst: u32) -> ClassPolicy {
        ClassPolicy::new(sustained, burst).unwrap()
    }

    #[test]
    fn policy_values_match_spec_defaults() {
        // Verifies: REQ-RL-001
        assert_eq!(RATE_POLICY.auth, class(10, 5));
        assert_eq!(RATE_POLICY.write, class(60, 20));
        assert_eq!(RATE_POLICY.read, class(300, 60));
        assert_eq!(RATE_POLICY.max_keys, 10_000);
        assert_eq!(RATE_POLICY.max_in_flight, 100);
        assert_eq!(policy(10, 5), RATE_POLICY.auth);

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

    // Verifies: REQ-RL-001 REQ-RL-002
    #[test]
    fn a_zero_rate_or_burst_cannot_be_built() {
        assert_eq!(ClassPolicy::new(0, 5), None);
        assert_eq!(ClassPolicy::new(10, 0), None);
        assert_eq!(ClassPolicy::new(0, 0), None);
        let zero_rate = r#"{"sustainedPerMinute":0,"burst":5}"#;
        assert!(serde_json::from_str::<ClassPolicy>(zero_rate).is_err());
        let zero_burst = r#"{"sustainedPerMinute":5,"burst":0}"#;
        assert!(serde_json::from_str::<ClassPolicy>(zero_burst).is_err());
        let fine = r#"{"sustainedPerMinute":5,"burst":2}"#;
        assert_eq!(
            serde_json::from_str::<ClassPolicy>(fine).unwrap(),
            class(5, 2)
        );
    }

    #[test]
    #[should_panic(expected = "non-zero rate and burst")]
    fn a_zero_constant_policy_does_not_compile() {
        // In a `const` this panic is a compile error; here it runs once to prove the guard.
        let _ = policy(0, 1);
    }

    // Verifies: REQ-RL-002
    #[test]
    fn take_is_total_at_the_extremes() {
        let policies = [
            class(1, 1),
            class(u32::MAX, 1),
            class(1, u32::MAX),
            class(u32::MAX, u32::MAX),
        ];
        let buckets = [
            Bucket {
                units: 0,
                last_refill_at_ms: 0,
            },
            Bucket {
                units: u64::MAX,
                last_refill_at_ms: u64::MAX,
            },
            Bucket {
                units: 0,
                last_refill_at_ms: u64::MAX,
            },
        ];
        for policy in policies {
            for bucket in buckets {
                for now in [0, 1, 59_999, u64::MAX] {
                    let res = take(&bucket, &policy, now);
                    assert_eq!(res.allowed, res.retry_after_secs.is_none());
                    assert!(res.bucket.units <= policy.burst_units().max(bucket.units));
                    let _ = bucket.is_idle_and_full(&policy, now);
                }
            }
        }
        // The slowest possible refill: one token per minute, so one whole minute to wait.
        let slow = class(1, 1);
        let empty = Bucket {
            units: 0,
            last_refill_at_ms: 0,
        };
        assert_eq!(take(&empty, &slow, 0).retry_after_secs, Some(60));
    }

    // Verifies: REQ-RL-006
    #[test]
    fn idle_and_full_detection() {
        let policy = class(10, 5);
        assert_eq!(policy.full_refill_ms(), 30_000);
        let bucket = Bucket::full(&policy, 0);
        assert!(!bucket.is_idle_and_full(&policy, 10_000));
        assert!(bucket.is_idle_and_full(&policy, 30_000));
        assert_eq!(bucket.droppable_at_ms(&policy), 30_000);

        let partial = Bucket {
            units: 100,
            last_refill_at_ms: 0,
        };
        assert!(!partial.is_idle_and_full(&policy, 29_999));
        assert!(partial.is_idle_and_full(&policy, 30_000));

        let late = Bucket {
            units: 0,
            last_refill_at_ms: u64::MAX,
        };
        assert_eq!(late.droppable_at_ms(&policy), u64::MAX);
    }
}
