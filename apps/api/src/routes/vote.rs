//! `POST /api/vote/eligibility` and `GET /api/vote/countries[/{code}]`.
//! Delegates to `rust_core` (see `docs/SAMPLE_APP.md`).

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use rust_core::feedback::ErrorCode;
use rust_core::{CountryVotingAge, VoteEligibilityRequest, SUPPORTED_COUNTRIES};
use serde::Serialize;

use crate::error::ApiError;
use crate::geo::{country_from_client_ip, extract_client_ip};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct CountriesResponse {
    pub countries: &'static [CountryVotingAge],
}

/// `GET /api/vote/countries` — list supported countries (REQ-API-009).
pub async fn list_countries_handler() -> Json<CountriesResponse> {
    Json(CountriesResponse {
        countries: SUPPORTED_COUNTRIES,
    })
}

/// `GET /api/vote/countries/{code}` — single country lookup (REQ-API-010).
pub async fn get_country_handler(
    Path(code): Path<String>,
) -> Result<Json<CountryVotingAge>, ApiError> {
    rust_core::validate_country_code(&code)?;

    let country = SUPPORTED_COUNTRIES
        .iter()
        .find(|c| c.country_code.eq_ignore_ascii_case(&code))
        .ok_or_else(|| ApiError::Rejected {
            code: ErrorCode::RouteNotFound,
            message: "Country not supported".to_string(),
        })?;

    Ok(Json(*country))
}

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
