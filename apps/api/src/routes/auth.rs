//! `/api/auth/*`: sign in, who am I, refresh, sign out (REQ-SEC-006 to REQ-SEC-011).
//!
//! The sample's sign-in has no credential check: choosing a role is the whole "login". A fork puts
//! its password, passkey or OIDC verification in front of [`sign_in`]; everything after is real.
//! Request and response samples: `docs/API.md`.

use axum::body::Bytes;
use axum::extract::rejection::{BytesRejection, JsonRejection};
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rust_core::feedback::ErrorCode;
use rust_core::session::SESSION_POLICY;
use rust_core::UserRole;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::secret::Secret;
use crate::session_store::{SessionUser, StoredSession, Transport};
use crate::sessions::IssuedTokens;
use crate::state::AppState;

/// Name of the cookie that carries the refresh token on the cookie transport.
pub const REFRESH_COOKIE: &str = "tran_refresh";

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RoleParam {
    CitizenVoter,
    ElectionAuditor,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TransportParam {
    Cookie,
    Body,
}

#[derive(Debug, Deserialize)]
pub struct SignInRequest {
    role: RoleParam,
    transport: TransportParam,
}

#[derive(Debug, Deserialize)]
struct RefreshBody {
    refresh_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserBody {
    pub user_id: String,
    pub role: &'static str,
}

impl From<&SessionUser> for UserBody {
    fn from(user: &SessionUser) -> Self {
        Self {
            user_id: user.user_id.clone(),
            role: user.role.as_str(),
        }
    }
}

#[derive(Debug, Serialize)]
struct TokenBody {
    access_token: String,
    token_type: &'static str,
    expires_in: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
    user: UserBody,
}

/// The demo's stable user per role; the clients show the same ids offline.
fn demo_user(role: RoleParam) -> SessionUser {
    let (user_id, role) = match role {
        RoleParam::CitizenVoter => ("voter-001", UserRole::CitizenVoter),
        RoleParam::ElectionAuditor => ("auditor-001", UserRole::ElectionAuditor),
    };
    SessionUser {
        user_id: user_id.to_string(),
        role,
    }
}

/// `Set-Cookie` for the refresh token; an empty value with `max_age` 0 clears it.
fn refresh_cookie(value: &str, max_age: u64, requires_https: bool) -> HeaderValue {
    let secure = if requires_https { "; Secure" } else { "" };
    let cookie = format!(
        "{REFRESH_COOKIE}={value}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age={max_age}{secure}"
    );
    #[allow(
        clippy::expect_used,
        reason = "the value is a base64url token or empty, both header-safe"
    )]
    HeaderValue::from_str(&cookie).expect("a refresh cookie is header-safe")
}

pub(crate) fn clear_cookie(response: &mut Response, requires_https: bool) {
    response
        .headers_mut()
        .insert(header::SET_COOKIE, refresh_cookie("", 0, requires_https));
}

/// The answer that hands a pair to the client: the refresh token on the session's transport only.
fn issued(
    status: StatusCode,
    session: &StoredSession,
    tokens: IssuedTokens,
    requires_https: bool,
) -> Response {
    let by_body = session.transport == Transport::Body;
    let body = TokenBody {
        access_token: tokens.access.expose().to_string(),
        token_type: "Bearer",
        expires_in: SESSION_POLICY.access_ttl_seconds,
        refresh_token: by_body.then(|| tokens.refresh.expose().to_string()),
        user: UserBody::from(&session.user),
    };
    let mut response = (status, Json(body)).into_response();
    if !by_body {
        response.headers_mut().insert(
            header::SET_COOKIE,
            refresh_cookie(
                tokens.refresh.expose(),
                SESSION_POLICY.refresh_ttl_seconds,
                requires_https,
            ),
        );
    }
    response
}

fn session_expired() -> ApiError {
    ApiError::Rejected {
        code: ErrorCode::AuthSessionExpired,
        message: "The session is missing, expired or revoked; sign in again".to_string(),
    }
}

/// A refresh token and the transport it arrived on: the cookie wins over the body.
struct Presented {
    token: Secret,
    via: Transport,
}

fn presented_refresh(headers: &HeaderMap, body: &[u8]) -> Option<Presented> {
    let cookie = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(REFRESH_COOKIE)?.strip_prefix('='))
        .filter(|token| !token.is_empty())
        .map(|token| (token.to_string(), Transport::Cookie));
    let body = || {
        serde_json::from_slice::<RefreshBody>(body)
            .ok()?
            .refresh_token
            .map(|token| (token, Transport::Body))
    };
    cookie.or_else(body).map(|(token, via)| Presented {
        token: Secret::new(token),
        via,
    })
}

/// `POST /api/auth/session` — sign in as a role; `201` with the first pair (REQ-SEC-006).
pub async fn sign_in(
    State(state): State<AppState>,
    payload: Result<Json<SignInRequest>, JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(request) = payload?;
    let session = StoredSession {
        user: demo_user(request.role),
        transport: match request.transport {
            TransportParam::Cookie => Transport::Cookie,
            TransportParam::Body => Transport::Body,
        },
    };
    let tokens = state.sessions.sign_in(session.clone());
    Ok(issued(
        StatusCode::CREATED,
        &session,
        tokens,
        state.edge.requires_https,
    ))
}

/// The session behind `Authorization: Bearer <access token>` (REQ-SEC-008).
#[derive(Debug)]
pub struct Authenticated(pub StoredSession);

/// Every bad token gets this one answer: `401 auth.session_expired` with `WWW-Authenticate`.
#[derive(Debug)]
pub struct Unauthenticated;

impl IntoResponse for Unauthenticated {
    fn into_response(self) -> Response {
        let mut response = session_expired().into_response();
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        response
    }
}

impl FromRequestParts<AppState> for Authenticated {
    type Rejection = Unauthenticated;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split_once(' '))
            .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
            .and_then(|(_, token)| state.sessions.authenticate(token.trim()))
            .map(Authenticated)
            .ok_or(Unauthenticated)
    }
}

/// `GET /api/auth/session` — who the access token belongs to.
pub async fn current_session(Authenticated(session): Authenticated) -> Json<UserBody> {
    Json(UserBody::from(&session.user))
}

/// `POST /api/auth/refresh` — spend the refresh token for a new pair (REQ-SEC-009, REQ-SEC-010).
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let requires_https = state.edge.requires_https;
    let presented = presented_refresh(&headers, &body.unwrap_or_default());
    let rotated = presented
        .as_ref()
        .and_then(|p| state.sessions.refresh(p.token.expose()).ok());
    match rotated {
        Some((session, tokens)) => issued(StatusCode::OK, &session, tokens, requires_https),
        None => {
            let mut response = session_expired().into_response();
            if presented.map(|p| p.via) != Some(Transport::Body) {
                clear_cookie(&mut response, requires_https);
            }
            response
        }
    }
}

/// `POST /api/auth/sign-out` — revoke the session; `204` whatever was sent (REQ-SEC-011).
pub async fn sign_out(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let presented = presented_refresh(&headers, &body.unwrap_or_default());
    if let Some(p) = &presented {
        state.sessions.sign_out(p.token.expose());
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    if presented.map(|p| p.via) != Some(Transport::Body) {
        clear_cookie(&mut response, state.edge.requires_https);
    }
    response
}
