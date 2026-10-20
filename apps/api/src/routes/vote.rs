//! `POST /api/vote/eligibility` — delegates to `rust_core::TranEngine` (see `docs/SAMPLE_APP.md`).

use axum::extract::rejection::JsonRejection;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use rust_core::VoteEligibilityRequest;

use crate::error::ApiError;
use crate::geo::{country_from_client_ip, extract_client_ip};
use crate::state::AppState;

pub async fn eligibility_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<VoteEligibilityRequest>, JsonRejection>,
) -> Result<Json<rust_core::VoteEligibilityResponse>, ApiError> {
    let Json(payload) = payload?;
    let forwarded = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok());
    let direct = headers.get("x-real-ip").and_then(|v| v.to_str().ok());
    let client_ip = extract_client_ip(forwarded, direct);

    let debug_country = headers
        .get("x-debug-country")
        .filter(|_| state.allow_debug_headers)
        .and_then(|v| v.to_str().ok());

    let (country_code, country_source) = country_from_client_ip(&client_ip, debug_country);

    let response = state.engine.evaluate_vote_eligibility(
        payload,
        &country_code,
        &country_source,
        &client_ip,
    )?;

    Ok(Json(response))
}
