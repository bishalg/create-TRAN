// Verifies: REQ-RL-001 REQ-RL-003 REQ-RL-004 REQ-RL-005 REQ-RL-008 REQ-RL-010
//! Rate limiting middleware (spec 031, ADR-0050).

use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::{AUTHORIZATION, COOKIE, RETRY_AFTER};
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;
use rust_core::rate::{RatePolicy, RouteClass};
use serde::Deserialize;

use crate::clock::Clock;
use crate::error::ApiError;
use crate::geo::{extract_client_ip, Cidr};
use crate::rate_limit_store::RateLimitStore;
use crate::routes::table::route_class;
use crate::sessions::Sessions;

#[derive(Clone)]
pub struct RateLimitState {
    pub store: Arc<dyn RateLimitStore>,
    pub rate_policy: RatePolicy,
    pub trusted_proxies: Arc<[Cidr]>,
    pub sessions: Sessions,
    pub clock: Arc<dyn Clock>,
}

#[derive(Deserialize)]
struct RefreshPayload {
    refresh_token: Option<String>,
}

fn hex_digest(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(&mut s, "{:02x}", b);
    }
    s
}

pub async fn rate_limit(
    State(state): State<RateLimitState>,
    mut request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    let class = route_class(&path, &method);

    // Health and configuration routes are exempt (REQ-RL-001).
    let Some(policy) = state.rate_policy.for_class(class) else {
        return next.run(request).await;
    };

    let peer_addr = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());

    let forwarded = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok());
    let direct = request
        .headers()
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok());

    let client_ip = extract_client_ip(forwarded, direct, peer_addr, &state.trusted_proxies);
    let now_ms = state.clock.now().timestamp_millis() as u64;

    // 1. Primary check by key (REQ-RL-003, REQ-RL-005)
    let key = if class == RouteClass::Auth {
        // Auth routes are limited by address before authentication (REQ-RL-005).
        format!("ip:{client_ip}")
    } else {
        // Signed-in calls counted by user; otherwise counted by client IP (REQ-RL-003).
        let bearer_user = if let Some(token) = request
            .headers()
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split_once(' '))
            .filter(|(s, _)| s.eq_ignore_ascii_case("bearer"))
            .map(|(_, t)| t.trim())
        {
            state
                .sessions
                .authenticate(token)
                .ok()
                .flatten()
                .map(|s| s.session.user.user_id)
        } else {
            None
        };

        match bearer_user {
            Some(user_id) => format!("user:{user_id}"),
            None => format!("ip:{client_ip}"),
        }
    };

    let class_name = class.as_str();
    match state.store.take(&key, class, &policy, now_ms) {
        Ok(result) => {
            if !result.allowed {
                if state.store.should_log_limited(&key, now_ms) {
                    tracing::warn!(class = class_name, "rate limited");
                }
                let retry_after = result.retry_after_secs.unwrap_or(1);
                let mut resp = ApiError::Rejected {
                    code: ErrorCode::ServerRateLimited,
                    message: "Rate limit exceeded".to_string(),
                }
                .into_response();
                resp.headers_mut()
                    .insert(RETRY_AFTER, HeaderValue::from(retry_after));
                return resp;
            }
        }
        Err(_) => {
            // REQ-RL-010: Fail open for write/read, fail closed for auth with 503.
            if class == RouteClass::Auth {
                if state.store.should_log_limited(&key, now_ms) {
                    tracing::error!(class = class_name, "rate limit store failed on auth route");
                }
                let mut resp = ApiError::Rejected {
                    code: ErrorCode::ServerUnavailable,
                    message: "Rate limit store unavailable".to_string(),
                }
                .into_response();
                resp.headers_mut()
                    .insert(RETRY_AFTER, HeaderValue::from_static("1"));
                return resp;
            } else {
                tracing::warn!(class = class_name, "rate limit store failed, failing open");
            }
        }
    }

    // 2. Secondary check for auth refresh per session/token (REQ-RL-005)
    if path == "/api/v1/auth/refresh" {
        // Extract refresh token from cookie or body
        let cookie_token = request
            .headers()
            .get_all(COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(';'))
            .find_map(|pair| pair.trim().strip_prefix("tran_refresh="))
            .filter(|t| !t.is_empty())
            .map(|t| t.to_string());

        let (refresh_token, request_to_run) = if let Some(ct) = cookie_token {
            (Some(ct), request)
        } else {
            let (parts, body) = request.into_parts();
            let bytes = match to_bytes(body, 4096).await {
                Ok(b) => b,
                Err(_) => {
                    return ApiError::Rejected {
                        code: ErrorCode::RequestMalformed,
                        message: "Invalid body".to_string(),
                    }
                    .into_response();
                }
            };
            let token = serde_json::from_slice::<RefreshPayload>(&bytes)
                .ok()
                .and_then(|p| p.refresh_token);
            let reconstructed = Request::from_parts(parts, Body::from(bytes));
            (token, reconstructed)
        };

        request = request_to_run;

        if let Some(token) = refresh_token {
            let digest_bytes = crate::sessions::digest(&token);
            let session_key = format!("refresh_digest:{}", hex_digest(&digest_bytes));

            let result = match state
                .store
                .take(&session_key, RouteClass::Auth, &policy, now_ms)
            {
                Ok(r) => r,
                Err(_) => {
                    let mut resp = ApiError::Rejected {
                        code: ErrorCode::ServerUnavailable,
                        message: "Rate limit store unavailable".to_string(),
                    }
                    .into_response();
                    resp.headers_mut()
                        .insert(RETRY_AFTER, HeaderValue::from_static("1"));
                    return resp;
                }
            };

            if !result.allowed {
                if state.store.should_log_limited(&session_key, now_ms) {
                    tracing::warn!(class = class_name, "rate limited");
                }
                let retry_after = result.retry_after_secs.unwrap_or(1);
                let mut resp = ApiError::Rejected {
                    code: ErrorCode::ServerRateLimited,
                    message: "Rate limit exceeded".to_string(),
                }
                .into_response();
                resp.headers_mut()
                    .insert(RETRY_AFTER, HeaderValue::from(retry_after));
                return resp;
            }
        }
    }

    next.run(request).await
}
