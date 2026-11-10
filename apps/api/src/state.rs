use std::sync::Arc;
use std::time::Instant;

use rust_core::TranEngine;

use crate::account::{AccountEraser, SessionsOnly};
use crate::config::{AppConfig, LOCAL_DEV_ORIGINS};
use crate::push::providers::PushProviders;
use crate::push::Push;
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
    /// What `DELETE /api/account` erases (REQ-ACC-001); a fork puts its own tables here.
    pub eraser: Arc<dyn AccountEraser>,
    /// The real push senders that are configured; none by default (ADR-0046).
    pub push_providers: Arc<PushProviders>,
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
            eraser: Arc::new(SessionsOnly),
            push_providers: Arc::new(PushProviders::off()),
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

    /// Sends to this state's registry through its configured senders.
    pub fn push(&self) -> Push {
        Push::new(
            &self.sessions,
            self.push_providers.clone(),
            self.push_providers.apns_topic(),
        )
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
