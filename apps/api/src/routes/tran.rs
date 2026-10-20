use axum::Json;
use serde_json::{json, Value};

pub async fn stack_info_handler() -> Json<Value> {
    Json(json!({
        "stack": "TRAN",
        "description": "Voting Eligibility demo — TanStack + Rust Core + Axum + Native",
        "demo": "voting-eligibility",
        "layers": {
            "T": "Vite + React SPA today; TanStack Start SSR is planned (ADR-0010, REQ-SEO)",
            "R": "Rust Core (Shared logic, Domain, Validation, Algorithms)",
            "A": "Axum (High-performance Async Web Backend)",
            "N": "Native mobile — SwiftUI (iOS) and Jetpack Compose (Android); apps/ios + apps/android"
        },
        "version": env!("CARGO_PKG_VERSION")
    }))
}
