//! Library surface for the in-repo tokens / i18n codegen binary (ADR-0025).
//!
//! The binary remains in this workspace; destinations come from
//! `tooling/design-tokens/codegen.json`. Publish only when a second consumer exists.

pub mod color_hex;
pub mod config;
pub mod design_md;
pub mod rules_ts;

pub use config::{CodegenConfig, CodegenPaths, CODEGEN_CONFIG_RELATIVE};
pub use design_md::render_design_md;
pub use rules_ts::render_rules_ts;
