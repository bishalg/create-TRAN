//! `/api/devices/{installation_id}`: register and unregister this installation's push token
//! (REQ-PSH-001, REQ-PSH-002, REQ-PSH-004, REQ-PSH-007, ADR-0044).
//!
//! Both need a bearer token, run behind the same `Origin` check and `Cache-Control: no-store` as
//! the session routes, and answer failures with the one envelope. Neither the installation id nor
//! the token appears in a response, an error or a log. Request and response samples:
//! `docs/API.md`.

use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use rust_core::feedback::ErrorCode;
use serde::Deserialize;

use super::auth::Authenticated;
use crate::devices::{
    is_app_version, is_locale_tag, DevicePlatform, InstallationId, PushEnvironment, PushToken,
    Registration,
};
use crate::error::ApiError;
use crate::state::AppState;

/// The body of `PUT /api/devices/{installation_id}`. Unknown fields are refused.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceBody {
    platform: DevicePlatform,
    push_token: String,
    environment: PushEnvironment,
    locale: String,
    app_version: String,
    /// Off unless the person opted in to marketing messages.
    #[serde(default)]
    marketing: bool,
}

/// A `400 request.malformed` naming what is wrong, never the value.
fn invalid(what: &str) -> ApiError {
    ApiError::Rejected {
        code: ErrorCode::RequestMalformed,
        message: format!("{what} (see docs/API.md)"),
    }
}

/// The path's installation id; an undecodable path is refused like a malformed id.
fn installation(path: Result<Path<String>, PathRejection>) -> Result<InstallationId, ApiError> {
    path.ok()
        .and_then(|Path(raw)| InstallationId::parse(&raw))
        .ok_or_else(|| invalid("The installation id must be a random UUID"))
}

/// `PUT /api/devices/{installation_id}` — create or replace this installation's registration,
/// bound to the caller and this session; `204`. Idempotent.
pub async fn register(
    State(state): State<AppState>,
    Authenticated(live): Authenticated,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<DeviceBody>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let installation = installation(path)?;
    let Json(body) = body?;
    let token = PushToken::parse(body.platform, &body.push_token)
        .ok_or_else(|| invalid("The push token is not a token of that platform"))?;
    if body.platform == DevicePlatform::Android && body.environment != PushEnvironment::Production {
        return Err(invalid("An Android registration is always in production"));
    }
    if !is_locale_tag(&body.locale) {
        return Err(invalid(
            "The locale must be a language tag such as en or ne-NP",
        ));
    }
    if !is_app_version(&body.app_version) {
        return Err(invalid("The app version must look like 1.4.0"));
    }
    let registration = Registration {
        installation,
        user_id: live.session.user.user_id,
        session: live.id,
        platform: body.platform,
        environment: body.environment,
        token,
        locale: body.locale,
        app_version: body.app_version,
        marketing: body.marketing,
        refreshed_at: state.sessions.clock().now(),
    };
    let (platform, environment) = (body.platform.as_str(), body.environment.as_str());
    let replaced = state.sessions.register_device(registration);
    tracing::info!(platform, environment, replaced, "device registered");
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /api/devices/{installation_id}` — remove this installation's registration if it is
/// the caller's; `204` whether or not there was one.
pub async fn unregister(
    State(state): State<AppState>,
    Authenticated(live): Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ApiError> {
    let installation = installation(path)?;
    let removed = state
        .sessions
        .devices()
        .unregister(&live.session.user.user_id, &installation);
    tracing::info!(removed, "device unregistered");
    Ok(StatusCode::NO_CONTENT)
}
