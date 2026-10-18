use axum::extract::State;
use axum::Json;
use rust_core::{CalculationRequest, CalculationResponse};
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::state::AppState;

pub async fn compute_handler(
    State(state): State<AppState>,
    Json(payload): Json<CalculationRequest>,
) -> Result<Json<CalculationResponse>, ApiError> {
    let response = state.engine.compute(payload)?;
    Ok(Json(response))
}

pub async fn stack_info_handler() -> Json<Value> {
    Json(json!({
        "stack": "TRAN",
        "description": "TanStack Start + Rust Core + Axum + Native iOS/Android Monorepo",
        "layers": {
            "T": "TanStack Start (Web App with SSR, Router, Streaming)",
            "R": "Rust Core (Shared logic, Domain, Validation, Algorithms)",
            "A": "Axum (High-performance Async Web Backend)",
            "N": "Native (React Native / Expo iOS & Android Mobile)"
        },
        "version": env!("CARGO_PKG_VERSION")
    }))
}
