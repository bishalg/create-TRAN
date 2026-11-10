//! `x-request-id` on every response (REQ-ERR-002): reuse a well-formed incoming id, otherwise mint
//! one. The id scopes the request's logs and is echoed in error bodies (`error::REQUEST_ID`). Every
//! request ends with one `debug` event, `request completed`, carrying its status and latency
//! (REQ-ROB-007) — visible with `RUST_LOG=api=debug`, silent at the production default. The span's
//! `path` is the [`loggable_path`], a product route's template, so an installation id never reaches
//! a log (REQ-PSH-007). Right after the id, the client is identified once
//! ([`super::client::identify`]): the span carries `client_platform` and `client_version`
//! (REQ-VER-004), so every event of the request, the access log included, names the app version.

use std::time::Instant;

use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use rust_core::feedback::is_valid_request_id;
use tracing::Instrument;
use uuid::Uuid;

use super::client::{identify, NO_VERSION};
use crate::error::REQUEST_ID;
use crate::routes::table::loggable_path;

pub const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

pub async fn request_id(mut request: Request, next: Next) -> Response {
    let started = Instant::now();
    let id = request
        .headers()
        .get(&REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_valid_request_id(value))
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let client = identify(&mut request);
    let client_platform = client.platform.as_str();
    let client_version = client.version.as_deref().unwrap_or(NO_VERSION);

    let span = tracing::info_span!(
        "request",
        request_id = %id,
        method = %request.method(),
        path = %loggable_path(request.uri().path()),
        client_platform,
        client_version
    );
    let mut response = REQUEST_ID
        .scope(id.clone(), next.run(request))
        .instrument(span.clone())
        .await;
    let status = response.status().as_u16();
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    span.in_scope(|| tracing::debug!(status, latency_ms, "request completed"));
    #[allow(
        clippy::expect_used,
        reason = "the id is validated ASCII from `is_valid_request_id` or a fresh UUID"
    )]
    let value = HeaderValue::from_str(&id).expect("request ids are header-safe");
    response.headers_mut().insert(REQUEST_ID_HEADER, value);
    response
}
