//! Deprecation is announced before removal (REQ-VER-007): a route the table marks deprecated
//! answers as usual, plus `Deprecation` (RFC 9745) and `Sunset` (RFC 8594), and logs one `info`
//! event per request with the client's platform and version, so the logs say who still calls it.

use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

use super::client::{client_of, NO_VERSION};
use crate::routes::table::{find, Route};

pub const DEPRECATION: HeaderName = HeaderName::from_static("deprecation");
pub const SUNSET: HeaderName = HeaderName::from_static("sunset");

/// `table` is [`crate::routes::table::ROUTES`] in the app; tests pass their own.
pub async fn deprecation(
    State(table): State<&'static [Route]>,
    request: Request,
    next: Next,
) -> Response {
    let found = find(table, request.method(), request.uri().path())
        .and_then(|route| route.deprecated.map(|sunset| (route, sunset)));
    let Some((route, sunset)) = found else {
        return next.run(request).await;
    };
    let client = client_of(&request);
    let route_template = route.template();
    let client_platform = client.platform.as_str();
    let client_version = client.version.as_deref().unwrap_or(NO_VERSION);
    let sunset_date = sunset.sunset_header();
    // Evaluated before the macro, so coverage does not depend on a subscriber being installed.
    let method = route.verb.as_str();
    tracing::info!(
        route = %route_template,
        method,
        client_platform,
        client_version,
        sunset = %sunset_date,
        "deprecated route called"
    );
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    for (name, value) in [
        (DEPRECATION, sunset.deprecation_header()),
        (SUNSET, sunset_date),
    ] {
        #[allow(
            clippy::expect_used,
            reason = "`@` and digits, or an IMF-fixdate: both header-safe ASCII"
        )]
        let value = HeaderValue::from_str(&value).expect("a date header is header-safe");
        headers.insert(name, value);
    }
    response
}
