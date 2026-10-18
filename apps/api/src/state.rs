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
