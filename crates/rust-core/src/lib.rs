//! # Rust Core for TRAN Stack
//!
//! Provides the foundational domain logic (voting eligibility rules), validation routines,
//! design tokens, and health diagnostic reporting shared across the Axum backend,
//! WASM/Native bridges, and developer tooling.

pub mod compat;
pub mod error;
pub mod feedback;
pub mod flags;
pub mod models;
pub mod navigation;
pub mod permissions;
pub mod personal_questions;
pub mod push;
pub mod rate;
pub mod screens;
pub mod services;
pub mod session;
pub mod stored_records;
#[cfg(test)]
mod test_support;
pub mod tokens;
pub mod trace;
pub mod validation;
pub mod voting;

pub use error::{CoreError, CoreResult};
pub use flags::*;
pub use models::*;
pub use navigation::*;
pub use screens::screens_json_snapshot;
pub use services::*;
pub use stored_records::*;
pub use tokens::{
    default_design_tokens, get_brand_tokens, tokens_json_snapshot, BrandDesignTokens,
};
pub use trace::*;
pub use validation::*;
pub use voting::*;
