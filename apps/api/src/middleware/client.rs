//! Who sent the request and whether its version is still served (spec 028, ADR-0047).
//!
//! [`identify`] parses `X-Tran-Client` once per request, inside the request id's span (REQ-VER-004):
//! the parsed [`Client`] goes into the request's extensions and its platform and version into the
//! access log, both bounded because only a validated version is kept. [`client_standing`] then
//! compares it with the platform's thresholds on product routes: below the minimum the request
//! answers `426 client.upgrade_required` before any handler runs (REQ-VER-005); below the
//! recommended version the answer carries `X-Tran-Update: recommended` and
//! `X-Tran-Recommended-Version` (REQ-VER-006). An unknown client is served.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::compat::{
    self, parse_client, Client, ClientStanding, CLIENT_HEADER, UPDATE_RECOMMENDED,
};
use rust_core::feedback::ErrorCode;

use crate::client_versions::ClientThresholds;
use crate::error::ApiError;
use crate::routes::is_product_path;

/// Product routes that answer even a client below its minimum, below [`compat::API_BASE_PATH`]: the
/// configuration route of spec 029 will be listed here, so an outdated app can still learn that it
/// must update (REQ-CFG-002).
pub const UPGRADE_EXEMPT: [&str; 0] = [];

/// What the access log shows for a client without a version.
pub const NO_VERSION: &str = "-";

/// Parses the header, stores the [`Client`] for the layers below and returns it for the log.
pub fn identify(request: &mut Request) -> Client {
    let client = parse_client(
        request
            .headers()
            .get(CLIENT_HEADER)
            .and_then(|value| value.to_str().ok()),
    );
    request.extensions_mut().insert(client.clone());
    client
}

/// The client [`identify`] stored; unknown when the layer did not run (a test-only stack).
pub fn client_of(request: &Request) -> Client {
    request
        .extensions()
        .get::<Client>()
        .cloned()
        .unwrap_or_else(Client::unknown)
}

fn is_exempt(path: &str) -> bool {
    path.strip_prefix(compat::API_BASE_PATH)
        .is_some_and(|rest| UPGRADE_EXEMPT.contains(&rest))
}

/// The `426` of REQ-VER-005 and the nudge of REQ-VER-006, on product routes only.
pub async fn client_standing(
    State(thresholds): State<Arc<ClientThresholds>>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !is_product_path(path) {
        return next.run(request).await;
    }
    let client = client_of(&request);
    let threshold = thresholds.for_platform(client.platform);
    let minimum = threshold.and_then(|t| t.minimum.as_deref());
    let recommended = threshold.and_then(|t| t.recommended.as_deref());
    match compat::client_standing(&client, minimum, recommended) {
        ClientStanding::UpgradeRequired if !is_exempt(path) => ApiError::Rejected {
            code: ErrorCode::ClientUpgradeRequired,
            message: "This app version is no longer supported; update the app".to_string(),
        }
        .into_response(),
        ClientStanding::UpdateRecommended => {
            let mut response = next.run(request).await;
            let headers = response.headers_mut();
            headers.insert(
                HeaderName::from_static("x-tran-update"),
                HeaderValue::from_static(UPDATE_RECOMMENDED),
            );
            #[allow(
                clippy::expect_used,
                reason = "only a recommended version makes this standing, and it was validated at \
                          start-up: digits, dots and `[0-9A-Za-z.-]`, all header-safe"
            )]
            let value = HeaderValue::from_str(recommended.unwrap_or_default())
                .expect("a validated version is header-safe");
            headers.insert(HeaderName::from_static("x-tran-recommended-version"), value);
            response
        }
        _ => next.run(request).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::compat::{RECOMMENDED_VERSION_HEADER, UPDATE_HEADER};

    #[test]
    fn header_names_match_the_catalogue() {
        assert_eq!(UPDATE_HEADER.to_ascii_lowercase(), "x-tran-update");
        assert_eq!(
            RECOMMENDED_VERSION_HEADER.to_ascii_lowercase(),
            "x-tran-recommended-version"
        );
        assert!(!is_exempt("/api/v1/vote/eligibility"));
        assert!(!is_exempt("/api/health"));
    }
}
