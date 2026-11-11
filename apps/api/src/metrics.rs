//! RED metrics and Prometheus exposition (spec 023, REQ-OBS-005, REQ-OBS-006).
//!
//! Exposes:
//! - `tran_http_requests_total{method,route,status}`
//! - `tran_http_request_duration_seconds{method,route}` with fixed buckets from 5ms to 10s
//! - `tran_http_requests_in_flight`
//! - `tran_build_info{version,commit}` = 1
//! - `tran_rate_limited_total{class}` (spec 031, REQ-RL-008)

use std::sync::OnceLock;

use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};

/// The release this binary is: the one workspace version (ADR-0034).
pub const BUILD_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The commit it was built from: `TRAN_COMMIT` at compile time (the image build sets it), else
/// `unknown`.
pub const BUILD_COMMIT: &str = match option_env!("TRAN_COMMIT") {
    Some(commit) => commit,
    None => "unknown",
};

static RECORDER_INITIALIZED: OnceLock<PrometheusHandle> = OnceLock::new();

/// Fixed histogram duration buckets from 5 ms to 10 s (REQ-OBS-005).
pub const DURATION_BUCKETS: &[f64] = &[
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

/// Initializes the global Prometheus recorder once and returns its handle.
pub fn init_metrics() -> PrometheusHandle {
    RECORDER_INITIALIZED
        .get_or_init(|| {
            #[allow(
                clippy::expect_used,
                reason = "hard-coded duration metric name is valid"
            )]
            let builder = PrometheusBuilder::new()
                .set_buckets_for_metric(
                    Matcher::Full("tran_http_request_duration_seconds".to_string()),
                    DURATION_BUCKETS,
                )
                .expect("valid bucket configuration");

            #[allow(clippy::expect_used, reason = "prometheus recorder is installed once")]
            let handle = builder
                .install_recorder()
                .expect("failed to install prometheus recorder");

            metrics::gauge!(
                "tran_build_info",
                "version" => BUILD_VERSION,
                "commit" => BUILD_COMMIT,
            )
            .set(1.0);
            handle
        })
        .clone()
}

/// Counts one limited request of `class` (REQ-RL-008).
pub fn record_rate_limited(class: rust_core::rate::RouteClass) {
    metrics::counter!("tran_rate_limited_total", "class" => class.as_str()).increment(1);
}

/// Normalizes HTTP method to one of the standard methods or `"OTHER"` (REQ-OBS-005).
pub fn normalize_method(method: &axum::http::Method) -> &'static str {
    match *method {
        axum::http::Method::GET => "GET",
        axum::http::Method::POST => "POST",
        axum::http::Method::PUT => "PUT",
        axum::http::Method::DELETE => "DELETE",
        axum::http::Method::HEAD => "HEAD",
        axum::http::Method::OPTIONS => "OPTIONS",
        axum::http::Method::PATCH => "PATCH",
        axum::http::Method::TRACE => "TRACE",
        axum::http::Method::CONNECT => "CONNECT",
        _ => "OTHER",
    }
}

/// Tracks in-flight HTTP requests (REQ-OBS-005).
pub struct InFlightGuard;

impl InFlightGuard {
    pub fn enter() -> Self {
        metrics::gauge!("tran_http_requests_in_flight").increment(1.0);
        Self
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        metrics::gauge!("tran_http_requests_in_flight").decrement(1.0);
    }
}

/// Records rate, error, and duration (RED) metrics for a completed request (REQ-OBS-005).
pub fn record_request_metrics(
    method: &'static str,
    route: &str,
    status: u16,
    duration_seconds: f64,
) {
    metrics::counter!(
        "tran_http_requests_total",
        "method" => method,
        "route" => route.to_string(),
        "status" => status.to_string(),
    )
    .increment(1);

    metrics::histogram!(
        "tran_http_request_duration_seconds",
        "method" => method,
        "route" => route.to_string(),
    )
    .record(duration_seconds);
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Method;

    #[test]
    fn methods_are_normalized_or_other() {
        assert_eq!(normalize_method(&Method::GET), "GET");
        assert_eq!(normalize_method(&Method::POST), "POST");
        assert_eq!(normalize_method(&Method::PUT), "PUT");
        assert_eq!(normalize_method(&Method::DELETE), "DELETE");
        assert_eq!(normalize_method(&Method::HEAD), "HEAD");
        assert_eq!(normalize_method(&Method::OPTIONS), "OPTIONS");
        assert_eq!(normalize_method(&Method::PATCH), "PATCH");
        assert_eq!(normalize_method(&Method::TRACE), "TRACE");
        assert_eq!(normalize_method(&Method::CONNECT), "CONNECT");
        let custom = Method::from_bytes(b"CUSTOM").unwrap();
        assert_eq!(normalize_method(&custom), "OTHER");
    }

    #[test]
    fn init_metrics_renders_build_info() {
        let handle = init_metrics();
        let rendered = handle.render();
        assert!(rendered.contains("tran_build_info"));
        assert!(rendered.contains(&format!(
            r#"tran_build_info{{version="{BUILD_VERSION}",commit="{BUILD_COMMIT}"}} 1"#
        )));
    }
}
