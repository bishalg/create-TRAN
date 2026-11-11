//! Feature flags and remote configuration for native apps (spec 029, ADR-0048).
//!
//! Exposes bucket derivation and flag evaluation over UniFFI.
//!
//! Verifies: REQ-CFG-001 REQ-CFG-003 REQ-CFG-006

use rust_core::compat::ClientPlatform;
use rust_core::flags::{self, ClientEvaluationContext, Rule};
use thiserror::Error as ThisError;

use crate::compat::TranClientPlatform;

/// Errors returned by UniFFI feature flag operations.
#[derive(Debug, Clone, PartialEq, Eq, ThisError, uniffi::Error)]
pub enum TranFlagError {
    /// The flag was not found in the catalogue.
    #[error("Unknown flag ID: {0}")]
    UnknownFlag(String),
    /// Failed to parse targeting rules JSON.
    #[error("Invalid rules JSON: {0}")]
    InvalidRulesJson(String),
}

/// Derives a stable rollout bucket from 0 to 99 from an installation ID (REQ-CFG-006).
#[uniffi::export]
pub fn tran_derive_bucket(installation_id: String) -> u8 {
    flags::derive_bucket(&installation_id)
}

/// Evaluates a boolean feature flag against targeting rules and client context (REQ-CFG-003).
#[uniffi::export]
pub fn tran_evaluate_flag_boolean(
    flag_id: String,
    rules_json: String,
    platform: TranClientPlatform,
    version: Option<String>,
    bucket: u8,
) -> Result<bool, TranFlagError> {
    let flag =
        flags::find_flag(&flag_id).ok_or_else(|| TranFlagError::UnknownFlag(flag_id.clone()))?;

    let rules: Vec<Rule> = serde_json::from_str(&rules_json)
        .map_err(|e| TranFlagError::InvalidRulesJson(e.to_string()))?;

    let ctx = ClientEvaluationContext {
        platform: ClientPlatform::from(platform),
        version: version.as_deref(),
        bucket,
    };

    let result = flags::evaluate(flag, &rules, &ctx);
    Ok(result.as_bool().unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniffi_derive_bucket_matches_core() {
        // Verifies: REQ-CFG-006
        assert_eq!(
            tran_derive_bucket("2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c".to_string()),
            83
        );
    }

    #[test]
    fn uniffi_evaluate_boolean_matches_core() {
        // Verifies: REQ-CFG-003
        let rules_json = r#"[{"platform":"ios","rollout":100,"value":true}]"#;
        let res = tran_evaluate_flag_boolean(
            "notify_me".to_string(),
            rules_json.to_string(),
            TranClientPlatform::Ios,
            Some("1.0.0".to_string()),
            10,
        )
        .unwrap();
        assert!(res);

        // Unknown flag fails
        let err = tran_evaluate_flag_boolean(
            "unknown_flag".to_string(),
            rules_json.to_string(),
            TranClientPlatform::Ios,
            Some("1.0.0".to_string()),
            10,
        )
        .unwrap_err();
        assert_eq!(err, TranFlagError::UnknownFlag("unknown_flag".to_string()));

        // Invalid JSON fails
        let err = tran_evaluate_flag_boolean(
            "notify_me".to_string(),
            "invalid json".to_string(),
            TranClientPlatform::Ios,
            Some("1.0.0".to_string()),
            10,
        )
        .unwrap_err();
        assert!(matches!(err, TranFlagError::InvalidRulesJson(_)));
    }
}
