use std::sync::Arc;
use std::time::Instant;

use rust_core::TranEngine;

use crate::config::AppConfig;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<TranEngine>,
    pub start_time: Instant,
    /// Whether `X-Debug-Country` may override IP-based country resolution (REQ-API-006).
    pub allow_debug_headers: bool,
}

impl AppState {
    /// Development defaults: debug headers are honoured.
    pub fn new() -> Self {
        Self {
            engine: Arc::new(TranEngine::new()),
            start_time: Instant::now(),
            allow_debug_headers: true,
        }
    }

    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            allow_debug_headers: config.allows_debug_headers(),
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
}
