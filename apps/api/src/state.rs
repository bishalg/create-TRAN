use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::Instant;

use rust_core::rate::{RatePolicy, RATE_POLICY};
use rust_core::TranEngine;

use crate::account::{AccountEraser, SessionsOnly};
use crate::client_versions::ClientThresholds;
use crate::clock::{Clock, SystemClock};
use crate::config::{AppConfig, LOCAL_DEV_ORIGINS};
use crate::config_source::{ConfigSource, FileConfigSource};
use crate::geo::Cidr;
use crate::middleware::rate_limit::StoreFailureLog;
use crate::push::providers::PushProviders;
use crate::push::Push;
use crate::rate_limit_store::{MemoryRateLimitStore, RateLimitStore};
use crate::sessions::Sessions;
use crate::signed_in::SignedInKeys;

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
    /// The clock buckets are measured on (REQ-RL-002).
    pub clock: Arc<dyn Clock>,
    /// The user of each access token this process issued or checked, so a signed-in request is
    /// counted by user without touching the session store (REQ-RL-003, REQ-RL-004).
    pub signed_in: Arc<SignedInKeys>,
    /// Keeps a failing limiter store to one log line per window (REQ-RL-010).
    pub store_failures: Arc<StoreFailureLog>,
}

impl EdgePolicy {
    /// An edge with a fresh limiter for `rate_policy`: an empty store, no request in flight, the
    /// real clock.
    pub fn new(
        allowed_origins: Arc<[String]>,
        requires_https: bool,
        client_thresholds: Arc<ClientThresholds>,
        trusted_proxies: Arc<[Cidr]>,
        rate_policy: RatePolicy,
    ) -> Self {
        Self {
            allowed_origins,
            requires_https,
            client_thresholds,
            trusted_proxies,
            rate_policy,
            rate_limit_store: Arc::new(MemoryRateLimitStore::new(rate_policy.max_keys)),
            in_flight: Arc::new(AtomicUsize::new(0)),
            clock: Arc::new(SystemClock),
            signed_in: Arc::new(SignedInKeys::new(rate_policy.max_keys)),
            store_failures: Arc::default(),
        }
    }
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
    /// Prometheus metrics handle (REQ-OBS-005, REQ-OBS-006).
    pub metrics_handle: metrics_exporter_prometheus::PrometheusHandle,
    /// Whether the server is ready to accept traffic (REQ-OBS-007, REQ-OBS-008).
    pub ready: Arc<std::sync::atomic::AtomicBool>,
    /// Remote configuration source (REQ-CFG-002, REQ-CFG-004).
    pub config_source: Arc<dyn ConfigSource>,
}

impl AppState {
    /// Development defaults: debug headers are honoured, the local dev origins are allowed, plain
    /// HTTP, sessions in a fresh in-memory database on the real clock. [`crate::run_server`] puts
    /// the configured database in its place.
    pub fn new() -> Self {
        let sessions = Sessions::in_memory();
        let metrics_handle = crate::metrics::init_metrics();
        let ready = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let config_source: Arc<dyn ConfigSource> =
            Arc::new(FileConfigSource::new(None, Arc::new(SystemClock)));

        Self {
            engine: Arc::new(TranEngine::new()),
            start_time: Instant::now(),
            allow_debug_headers: true,
            edge: EdgePolicy::new(
                LOCAL_DEV_ORIGINS.map(str::to_owned).into(),
                false,
                Arc::default(),
                Arc::new([]),
                RATE_POLICY,
            ),
            sessions,
            eraser: Arc::new(SessionsOnly),
            push_providers: Arc::new(PushProviders::off()),
            metrics_handle,
            ready,
            config_source,
        }
    }

    /// The state `config` describes. Configuration must be valid: [`crate::run_server`] refuses to
    /// start on any malformed value ([`AppConfig::validate`]) before it builds the state, so the
    /// fallbacks here (no thresholds, no trusted proxies, the canonical limits) are only reached by
    /// tests that build a state from a deliberately malformed configuration.
    pub fn from_config(config: &AppConfig) -> Self {
        let trusted = config.trusted_proxies().unwrap_or_default();
        let rate_policy = config.rate_policy().unwrap_or(RATE_POLICY);
        let sessions = Sessions::in_memory();
        let config_source: Arc<dyn ConfigSource> = Arc::new(FileConfigSource::new(
            config.remote_config_path.as_ref().map(PathBuf::from),
            Arc::new(SystemClock),
        ));

        Self {
            allow_debug_headers: config.allows_debug_headers(),
            edge: EdgePolicy::new(
                config.allowed_origins().into(),
                config.requires_https(),
                Arc::new(
                    ClientThresholds::from_settings(&config.client_versions).unwrap_or_default(),
                ),
                Arc::from(trusted),
                rate_policy,
            ),
            sessions,
            eraser: Arc::new(SessionsOnly),
            push_providers: Arc::new(PushProviders::off()),
            config_source,
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
