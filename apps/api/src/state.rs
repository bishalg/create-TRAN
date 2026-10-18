use std::sync::Arc;
use std::time::Instant;

use rust_core::TranEngine;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<TranEngine>,
    pub start_time: Instant,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(TranEngine::new()),
            start_time: Instant::now(),
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
