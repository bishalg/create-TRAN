//! The clock sessions are measured on, injected per ADR-0004 so expiry is tested without waiting.

use std::sync::{Mutex, PoisonError};

use chrono::{DateTime, Duration, Utc};

pub trait Clock: std::fmt::Debug + Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

/// The real clock, used by `run_server`.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A clock that moves only when told to, for tests.
#[derive(Debug)]
pub struct ManualClock(Mutex<DateTime<Utc>>);

impl ManualClock {
    pub fn starting_at(now: DateTime<Utc>) -> Self {
        Self(Mutex::new(now))
    }

    pub fn advance(&self, by: Duration) {
        let mut now = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        *now += by;
    }
}

impl Clock for ManualClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manual_clock_moves_only_when_advanced() {
        let start = DateTime::<Utc>::UNIX_EPOCH;
        let clock = ManualClock::starting_at(start);
        assert_eq!(clock.now(), start);
        clock.advance(Duration::seconds(900));
        assert_eq!(clock.now(), start + Duration::seconds(900));
    }

    #[test]
    fn the_system_clock_reads_the_current_time() {
        let before = Utc::now();
        assert!(SystemClock.now() >= before);
    }
}
