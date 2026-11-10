use std::sync::Arc;
use std::time::Instant;

use rust_core::TranEngine;

use crate::config::{AppConfig, LOCAL_DEV_ORIGINS};
use crate::sessions::Sessions;

/// What the HTTP edge enforces before any route runs.
#[derive(Debug, Clone)]
pub struct EdgePolicy {
    /// Browser origins allowed by CORS and by the auth `Origin` check (REQ-API-007, REQ-SEC-012).
    pub allowed_origins: Arc<[String]>,
    /// `Secure` cookies and HSTS (REQ-SEC-007, REQ-SEC-013).
    pub requires_https: bool,
}

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<TranEngine>,
    pub start_time: Instant,
    /// Whether `X-Debug-Country` may override IP-based country resolution (REQ-API-006).
    pub allow_debug_headers: bool,
    pub edge: EdgePolicy,
    pub sessions: Sessions,
}

impl AppState {
    /// Development defaults: debug headers are honoured, the local dev origins are allowed, plain
    /// HTTP, sessions in memory on the real clock.
    pub fn new() -> Self {
        Self {
            engine: Arc::new(TranEngine::new()),
            start_time: Instant::now(),
            allow_debug_headers: true,
            edge: EdgePolicy {
                allowed_origins: LOCAL_DEV_ORIGINS.map(str::to_owned).into(),
                requires_https: false,
            },
            sessions: Sessions::in_memory(),
        }
    }

    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            allow_debug_headers: config.allows_debug_headers(),
            edge: EdgePolicy {
                allowed_origins: config.allowed_origins().into(),
                requires_https: config.requires_https(),
            },
            ..Self::new()
        }
    }

    pub fn uptime_seconds(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_starts_with_zero_uptime() {
        assert_eq!(AppState::default().uptime_seconds(), 0);
    }

    #[test]
    fn uptime_counts_whole_seconds_since_start() {
        let five_seconds_ago = Instant::now()
            .checked_sub(std::time::Duration::from_secs(5))
            .unwrap();
        let state = AppState {
            start_time: five_seconds_ago,
            ..AppState::default()
        };
        assert_eq!(state.uptime_seconds(), 5);
    }
}
