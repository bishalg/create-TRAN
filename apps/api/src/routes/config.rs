//! Configuration route `GET /api/v1/config` (spec 029, ADR-0048).
//!
//! Evaluates declared feature flags for the caller's platform, version, and bucket.
//! Returns client version thresholds and supports conditional caching via ETag (REQ-CFG-002, REQ-CFG-008).
//!
//! Verifies: REQ-CFG-002 REQ-CFG-008

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_core::flags::{evaluate, ClientEvaluationContext, ALL_FLAGS, BUCKET_HEADER};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::middleware::client::client_of;
use crate::state::AppState;

/// Handles `GET /api/v1/config` (REQ-CFG-002, REQ-CFG-008).
pub async fn config_handler(State(state): State<AppState>, request: Request) -> Response {
    let client = client_of(&request);
    let bucket = request
        .headers()
        .get(BUCKET_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u8>().ok())
        .filter(|bucket| *bucket <= LAST_BUCKET);

    let ctx = ClientEvaluationContext {
        platform: client.platform,
        version: client.version.as_deref(),
        bucket: evaluated_bucket(bucket),
    };

    let active_rules = state.config_source.rules();
    let mut flags_map = serde_json::Map::new();
    for flag in ALL_FLAGS {
        let rules = active_rules
            .get(flag.id)
            .map(|r| r.as_slice())
            .unwrap_or(&[]);
        let val = evaluate(flag, rules, &ctx);
        #[allow(
            clippy::expect_used,
            reason = "all declared FlagValue variants serialize to JSON"
        )]
        let val_json = serde_json::to_value(&val).expect("flag values are json-serializable");
        flags_map.insert(flag.id.to_string(), val_json);
    }

    let threshold = state.edge.client_thresholds.for_platform(client.platform);
    let client_info = json!({
        "minimum_version": threshold.and_then(|t| t.minimum.clone()),
        "recommended_version": threshold.and_then(|t| t.recommended.clone()),
    });

    let body_json = json!({
        "config_version": state.config_source.config_version(),
        "flags": serde_json::Value::Object(flags_map),
        "client": client_info,
    });

    let body_bytes = serde_json::to_vec(&body_json).unwrap_or_default();
    let hash = Sha256::digest(&body_bytes);
    let mut hex_str = String::with_capacity(64);
    for byte in hash {
        use std::fmt::Write;
        let _ = write!(hex_str, "{byte:02x}");
    }
    let etag = format!("\"{hex_str}\"");

    #[allow(
        clippy::expect_used,
        reason = "etag is lowercase hex and double-quotes, which is always valid ASCII header"
    )]
    let etag_val = HeaderValue::from_str(&etag).expect("etag is header-safe");

    if let Some(if_none_match) = request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        let trimmed = if_none_match.trim();
        if trimmed == etag || trimmed == format!("W/{etag}") {
            let mut response = StatusCode::NOT_MODIFIED.into_response();
            cache_headers(response.headers_mut(), etag_val);
            return response;
        }
    }

    let mut response = (StatusCode::OK, body_bytes).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    cache_headers(headers, etag_val);
    response
}

/// The highest bucket a device derives (REQ-CFG-006).
const LAST_BUCKET: u8 = 99;

/// The bucket rules are evaluated with. A caller that sent none, or one outside `0..=99`, is
/// outside every partial rollout: a rule matches when the bucket is below its percentage, so
/// [`LAST_BUCKET`] matches only a rollout of 100 (REQ-CFG-002, REQ-CFG-003).
fn evaluated_bucket(sent: Option<u8>) -> u8 {
    sent.unwrap_or(LAST_BUCKET)
}

/// The answer depends on the caller's client and bucket headers: caches key on both, keep it
/// private to the caller, and revalidate with the `ETag` before each use.
fn cache_headers(headers: &mut axum::http::HeaderMap, etag: HeaderValue) {
    headers.insert(header::ETAG, etag);
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    headers.append(
        header::VARY,
        HeaderValue::from_static("x-tran-client, x-tran-bucket"),
    );
}
