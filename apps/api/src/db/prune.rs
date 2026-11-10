//! Deleting expired rows on a schedule (REQ-DB-009, REQ-PSH-005).
//!
//! [`spawn`] runs [`run_once`] when the server starts and then every
//! [`DB_POLICY`](super::DB_POLICY)`.prune_interval_seconds`; `api prune` runs it once. What is
//! expired is measured on the injected clock ([`Sessions::prune`]). The log says how many rows went,
//! never which.

use std::time::Duration;

use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use crate::session_store::StoreError;
use crate::sessions::Sessions;

/// How many rows one prune deleted, by kind.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PruneReport {
    /// Sessions past their refresh lifetime.
    pub sessions: usize,
    /// Access and refresh token digests past their expiry, spent or not.
    pub tokens: usize,
    /// Device registrations not refreshed for `DEVICE_POLICY.stale_after_days`.
    pub devices: usize,
}

/// Prunes once off the request runtime and logs the counts: `database pruned`, or `database prune
/// failed` with the store's fixed message.
pub async fn run_once(sessions: &Sessions) -> Result<PruneReport, StoreError> {
    let result = sessions.blocking(Sessions::prune).await;
    match &result {
        Ok(report) => {
            let (removed_sessions, tokens, devices) =
                (report.sessions, report.tokens, report.devices);
            tracing::info!(
                sessions = removed_sessions,
                tokens,
                devices,
                "database pruned"
            );
        }
        Err(error) => tracing::warn!(%error, "database prune failed"),
    }
    result
}

/// Prunes now, then every `every`, for as long as the runtime runs.
pub fn spawn(sessions: Sessions, every: Duration) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticks = tokio::time::interval(every);
        ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;
            // Both outcomes are logged by `run_once`; the next tick tries again.
            let _ = run_once(&sessions).await;
        }
    })
}
