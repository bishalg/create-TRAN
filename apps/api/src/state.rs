use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::Instant;

use rust_core::rate::{RatePolicy, RATE_POLICY};
use rust_core::TranEngine;

use crate::account::{AccountEraser, SessionsOnly};
use crate::client_versions::ClientThresholds;
use crate::config::{AppConfig, LOCAL_DEV_ORIGINS};
use crate::geo::Cidr;
use crate::push::providers::PushProviders;
use crate::push::Push;
use crate::rate_limit_store::{MemoryRateLimitStore, RateLimitStore};
use crate::sessions::Sessions;

/// What the HTTP edge enforces before any route runs.
#[derive(Clone)]
pub struct EdgePolicy {
    /// Browser origins allowed by CORS and by the auth `Origin` check (REQ-API-007, REQ-SEC-012).
    pub allowed_origins: Arc<[String]>,
    /// `Secure` cookies and HSTS (REQ-SEC-007, REQ-SEC-013).
    pub requires_https: bool,
    /// The minimum and recommended app version per platform (REQ-VER-005, REQ-VER-006).
    pub client_thresholds: Arc<ClientThresholds>,
    /// Reverse proxies trusted to provide `X-Forwarded-For` (REQ-RL-003).
    pub trusted_proxies: Arc<[Cidr]>,
    /// Effective rate limit policy (REQ-RL-001).
    pub rate_policy: RatePolicy,
    /// Rate limit bucket store (REQ-RL-006).
    pub rate_limit_store: Arc<dyn RateLimitStore>,
    /// Active in-flight requests count for load shedding (REQ-RL-007).
    pub in_flight: Arc<AtomicUsize>,
    /// Sessions provider for verifying bearer credentials on read/write routes (REQ-RL-003).
    pub sessions: Sessions,
}

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<TranEngine>,
    pub start_time: Instant,
    /// Whether `X-Debug-Country` may override IP-based country resolution (REQ-API-006).
    pub allow_debug_headers: bool,
    pub edge: EdgePolicy,
    pub sessions: Sessions,
    /// What `DELETE /api/v1/account` erases (REQ-ACC-001); a fork puts its own tables here.
    pub eraser: Arc<dyn AccountEraser>,
    /// The real push senders that are configured; none by default (ADR-0046).
    pub push_providers: Arc<PushProviders>,
    /// Rate limit bucket store (REQ-RL-006).
    pub rate_limit_store: Arc<dyn RateLimitStore>,
    /// Active in-flight requests count for load shedding (REQ-RL-007).
    pub in_flight: Arc<AtomicUsize>,
    /// Prometheus metrics handle (REQ-OBS-005, REQ-OBS-006).
    pub metrics_handle: metrics_exporter_prometheus::PrometheusHandle,
    /// Whether the server is ready to accept traffic (REQ-OBS-007, REQ-OBS-008).
    pub ready: Arc<std::sync::atomic::AtomicBool>,
}

impl AppState {
    /// Development defaults: debug headers are honoured, the local dev origins are allowed, plain
    /// HTTP, sessions in a fresh in-memory database on the real clock. [`crate::run_server`] puts
    /// the configured database in its place.
    pub fn new() -> Self {
        let sessions = Sessions::in_memory();
        let rate_policy = RATE_POLICY;
        let rate_limit_store: Arc<dyn RateLimitStore> =
            Arc::new(MemoryRateLimitStore::new(rate_policy.max_keys));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let metrics_handle = crate::metrics::init_metrics();
        let ready = Arc::new(std::sync::atomic::AtomicBool::new(true));

        Self {
            engine: Arc::new(TranEngine::new()),
            start_time: Instant::now(),
            allow_debug_headers: true,
            edge: EdgePolicy {
                allowed_origins: LOCAL_DEV_ORIGINS.map(str::to_owned).into(),
                requires_https: false,
                client_thresholds: Arc::default(),
                trusted_proxies: Arc::new([]),
                rate_policy,
                rate_limit_store: rate_limit_store.clone(),
                in_flight: in_flight.clone(),
                sessions: sessions.clone(),
            },
            sessions,
            eraser: Arc::new(SessionsOnly),
            push_providers: Arc::new(PushProviders::off()),
            rate_limit_store,
            in_flight,
            metrics_handle,
            ready,
        }
    }

    /// A malformed client version threshold counts as none here: [`crate::run_server`] refuses
    /// to start on one before it builds the state.
    pub fn from_config(config: &AppConfig) -> Self {
        let trusted = config.trusted_proxies().unwrap_or_default();
        let rate_policy = config.rate_policy().unwrap_or(RATE_POLICY);
        let sessions = Sessions::in_memory();
        let rate_limit_store: Arc<dyn RateLimitStore> =
            Arc::new(MemoryRateLimitStore::new(rate_policy.max_keys));
        let in_flight = Arc::new(AtomicUsize::new(0));

        Self {
            allow_debug_headers: config.allows_debug_headers(),
            edge: EdgePolicy {
                allowed_origins: config.allowed_origins().into(),
                requires_https: config.requires_https(),
                client_thresholds: Arc::new(
                    ClientThresholds::from_settings(&config.client_versions).unwrap_or_default(),
                ),
                trusted_proxies: Arc::from(trusted),
                rate_policy,
                rate_limit_store: rate_limit_store.clone(),
                in_flight: in_flight.clone(),
                sessions: sessions.clone(),
            },
            sessions,
            eraser: Arc::new(SessionsOnly),
            push_providers: Arc::new(PushProviders::off()),
            rate_limit_store,
            in_flight,
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

    /// Whether the server is ready to accept traffic (REQ-OBS-007, REQ-OBS-008).
    pub fn is_ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Marks the server as ready or not ready (REQ-OBS-007, REQ-OBS-008).
    pub fn set_ready(&self, ready: bool) {
        self.ready.store(ready, std::sync::atomic::Ordering::SeqCst);
    }

    /// Renders Prometheus metrics in text exposition format (REQ-OBS-005, REQ-OBS-006).
    pub fn render_metrics(&self) -> String {
        self.metrics_handle.render()
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
