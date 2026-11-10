//! `/api/v1/account`: delete the caller's account (REQ-ACC-001 to REQ-ACC-003, ADR-0041).
//!
//! The erasure itself is the [`AccountEraser`](crate::account::AccountEraser) in the state.
//! Request and response samples: `docs/API.md`.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use super::auth::{clear_cookie, Authenticated};
use crate::error::ApiError;
use crate::session_store::Transport;
use crate::state::AppState;

/// `DELETE /api/v1/account` — erase the caller's account and every session of it; `204`.
///
/// The log says that a deletion happened, never whose: the request id is the whole audit trail.
pub async fn delete_account(
    State(state): State<AppState>,
    Authenticated(live): Authenticated,
) -> Result<Response, ApiError> {
    let session = live.session;
    state.eraser.erase(&session.user, &state.sessions)?;
    tracing::info!("account deleted");
    let mut response = StatusCode::NO_CONTENT.into_response();
    if session.transport == Transport::Cookie {
        clear_cookie(&mut response, state.edge.requires_https);
    }
    Ok(response)
}
