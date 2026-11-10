//! # Rust Core for TRAN Stack
//!
//! Provides the foundational domain logic (voting eligibility rules), validation routines,
//! design tokens, and health diagnostic reporting shared across the Axum backend,
//! WASM/Native bridges, and developer tooling.

pub mod compat;
pub mod error;
pub mod feedback;
pub mod models;
pub mod navigation;
pub mod permissions;
pub mod personal_questions;
pub mod push;
pub mod screens;
pub mod services;
pub mod session;
#[cfg(test)]
mod test_support;
pub mod tokens;
pub mod validation;
pub mod voting;

pub use error::{CoreError, CoreResult};
pub use models::*;
pub use navigation::*;
pub use screens::screens_json_snapshot;
pub use services::*;
pub use tokens::{
    default_design_tokens, get_brand_tokens, tokens_json_snapshot, BrandDesignTokens,
};
pub use validation::*;
pub use voting::*;
