//! Library surface for the in-repo tokens / i18n codegen binary (ADR-0025).
//!
//! [`generate`] renders every artifact in memory; the binary writes them and prunes stale ones, and
//! `tests/generated_files.rs` checks them against the committed files (ADR-0030). Destinations come
//! from `tooling/design-tokens/codegen.json`. Publish only when a second consumer exists.
#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "build-time CLI: it reports what it wrote, and failing loudly is its error handling (ADR-0029)"
)]

pub mod config;
pub mod design_md;
pub mod feedback_ts;
pub mod files;
pub mod generate;
pub mod kotlin;
pub mod locales;
pub mod names;
pub mod rules_ts;
pub mod scale;
pub mod strings;
pub mod swift;
pub mod theme_css;
pub mod tokens_ts;

pub use config::{CodegenConfig, CodegenPaths, CODEGEN_CONFIG_RELATIVE};
pub use design_md::render_design_md;
pub use feedback_ts::render_feedback_ts;
pub use files::{remove_stale, stale_files, GeneratedFile};
pub use generate::{generate, generate_from};
pub use rules_ts::render_rules_ts;
