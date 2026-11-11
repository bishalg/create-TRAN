// Verifies: REQ-RL-001 REQ-RL-003 REQ-RL-004 REQ-RL-005 REQ-RL-008 REQ-RL-010
//! Rate limiting middleware (spec 031, ADR-0050).
//!
//! Every request of a limited class is counted before any handler runs and without touching the
//! session store or the database (REQ-RL-004): by the user of a known access token
//! ([`SignedInKeys`](crate::signed_in::SignedInKeys)), else by the [`ClientAddr`]. The refresh
//! route's second count, by the presented refresh token, runs in its handler through [`check`]
//! (REQ-RL-005), once the token has been read inside the body and time limits.

use std::sync::atomic::{AtomicU64, Ordering};

use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, RETRY_AFTER};
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;
use rust_core::rate::{ClassPolicy, RouteClass};

use super::client_addr;
use crate::error::ApiError;
use crate::metrics::record_rate_limited;
use crate::rate_limit_store::LOG_WINDOW_MS;
use crate::routes::table::{route_class, Route};
use crate::sessions::digest;
use crate::state::EdgePolicy;

/// What the limiter layer needs: the edge and the route table the router was built from.
#[derive(Clone)]
pub struct RateLimitState {
    pub edge: EdgePolicy,
    pub routes: &'static [Route],
}

/// One log line per window for a failing store, per process (REQ-RL-010). A stamp of `0` means
/// never; stamps are stored plus one so a clock at `0` still counts.
#[derive(Debug, Default)]
pub struct StoreFailureLog {
    fail_closed: AtomicU64,
    fail_open: AtomicU64,
}

impl StoreFailureLog {
    fn allow(stamp: &AtomicU64, now_ms: u64) -> bool {
        let last = stamp.load(Ordering::SeqCst);
        let due = last == 0 || now_ms.saturating_sub(last - 1) >= LOG_WINDOW_MS;
        due && stamp
            .compare_exchange(
                last,
                now_ms.saturating_add(1),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }
}

/// The catalogue's message for `server.rate_limited` (`errors.rateLimited`, REQ-RL-009).
const LIMITED_MESSAGE: &str = "Too many requests. Please wait a moment and try again.";

/// The edge's clock, in milliseconds since the epoch; a time before 1970 counts as `0`.
pub fn now_ms(edge: &EdgePolicy) -> u64 {
    u64::try_from(edge.clock.now().timestamp_millis()).unwrap_or(0)
}

/// Takes one token for `key`; `Some` is the answer to send instead of serving the request: `429`
/// with `Retry-After` when limited, `503` when the store fails on the auth class. Other classes
/// fail open (REQ-RL-010).
pub fn check(
    edge: &EdgePolicy,
    key: &str,
    class: RouteClass,
    policy: &ClassPolicy,
    now_ms: u64,
) -> Option<Response> {
    let store = &edge.rate_limit_store;
    let class_name = class.as_str();
    match store.take(key, class, policy, now_ms) {
        Ok(result) if result.allowed => None,
        Ok(result) => {
            record_rate_limited(class);
            if store.should_log_limited(key, class, now_ms) {
                tracing::warn!(class = class_name, "rate limited");
            }
            let retry_after = result.retry_after_secs.unwrap_or(1);
            Some(with_retry_after(
                ErrorCode::ServerRateLimited,
                LIMITED_MESSAGE,
                HeaderValue::from(retry_after),
            ))
        }
        Err(_) if class == RouteClass::Auth => {
            if StoreFailureLog::allow(&edge.store_failures.fail_closed, now_ms) {
                tracing::error!(class = class_name, "rate limit store failed on auth route");
            }
            Some(with_retry_after(
                ErrorCode::ServerUnavailable,
                "Rate limit store unavailable",
                HeaderValue::from_static("1"),
            ))
        }
        Err(_) => {
            if StoreFailureLog::allow(&edge.store_failures.fail_open, now_ms) {
                tracing::warn!(class = class_name, "rate limit store failed, failing open");
            }
            None
        }
    }
}

fn with_retry_after(code: ErrorCode, message: &str, retry_after: HeaderValue) -> Response {
    let mut response = ApiError::Rejected {
        code,
        message: message.to_string(),
    }
    .into_response();
    response.headers_mut().insert(RETRY_AFTER, retry_after);
    response
}

/// Who a request of `class` is counted as: the address on auth routes (before authentication,
/// REQ-RL-005); elsewhere the user of a known bearer token, else the address (REQ-RL-003).
fn key_for(edge: &EdgePolicy, request: &Request, class: RouteClass, now_ms: u64) -> String {
    let address = format!("ip:{}", client_addr::of(request.extensions()).0);
    if class == RouteClass::Auth {
        return address;
    }
    request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
        .and_then(|(_, token)| edge.signed_in.user(&digest(token.trim()), now_ms))
        .map_or(address, |user_id| format!("user:{user_id}"))
}

pub async fn rate_limit(
    State(state): State<RateLimitState>,
    request: Request,
    next: Next,
) -> Response {
    let class = route_class(state.routes, request.uri().path(), request.method());
    // Health and readiness probes are exempt (REQ-RL-001, REQ-RL-007).
    let Some(policy) = state.edge.rate_policy.for_class(class) else {
        return next.run(request).await;
    };
    let now_ms = now_ms(&state.edge);
    let key = key_for(&state.edge, &request, class, now_ms);
    match check(&state.edge, &key, class, &policy, now_ms) {
        Some(refused) => refused,
        None => next.run(request).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-RL-010
    #[test]
    fn a_store_failure_is_logged_once_per_window() {
        let log = StoreFailureLog::default();
        assert!(StoreFailureLog::allow(&log.fail_open, 0));
        assert!(!StoreFailureLog::allow(&log.fail_open, 59_999));
        assert!(StoreFailureLog::allow(&log.fail_open, 60_000));
        assert!(!StoreFailureLog::allow(&log.fail_open, 1));
        // The other event keeps its own window.
        assert!(StoreFailureLog::allow(&log.fail_closed, 1));
    }
}
