// Verifies: REQ-RL-003
//! The client's address, resolved once per request (spec 031, REQ-RL-003).
//!
//! [`client_address`] reads the socket peer from `ConnectInfo` and, only behind a trusted proxy,
//! `X-Forwarded-For` ([`crate::geo::client_address`]). The limiter and every handler read the
//! [`ClientAddr`] it stores, so no code path can take the address from a raw header.

use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::{ConnectInfo, FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::Response;

use crate::geo::{self, Cidr, NO_PEER};

/// Who the request came from, as far as the server can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientAddr(pub IpAddr);

/// Resolves the address and stores it as a request extension.
pub async fn client_address(
    State(trusted_proxies): State<Arc<[Cidr]>>,
    mut request: Request,
    next: Next,
) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(socket)| socket.ip());
    let addr = geo::client_address(request.headers(), peer, &trusted_proxies);
    request.extensions_mut().insert(ClientAddr(addr));
    next.run(request).await
}

/// The stored address; a router run without the layer (no extension) counts as [`NO_PEER`].
impl<S: Send + Sync> FromRequestParts<S> for ClientAddr {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(of(&parts.extensions))
    }
}

/// The address in `extensions`, or [`NO_PEER`].
pub fn of(extensions: &axum::http::Extensions) -> ClientAddr {
    extensions
        .get::<ClientAddr>()
        .copied()
        .unwrap_or(ClientAddr(NO_PEER))
}
