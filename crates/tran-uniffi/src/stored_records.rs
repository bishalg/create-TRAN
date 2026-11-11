//! Client stored record versioning and migration for native apps (spec 030, ADR-0049).
//!
//! Exposes the stored-record decision and the current schema numbers over UniFFI. The records
//! themselves never cross: each platform reads its own store (a refresh token stays native).
//!
//! Verifies: REQ-DB-011 REQ-DB-012

use rust_core::stored_records::{
    stored_record, CURRENT_CONFIG_SCHEMA, CURRENT_PUSH_SCHEMA, CURRENT_SESSION_SCHEMA,
};

/// What the native app does with a stored record version (REQ-DB-011).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranStoredRecordAction {
    /// The schema matches current; use the record as is.
    Use,
    /// The schema is from an older release; upgrade it to the current schema.
    Upgrade,
    /// The schema is newer than this build understands (or 0): treat the record as absent and
    /// leave it in place. Only an unreadable record is deleted (REQ-DB-012).
    Discard,
}

impl From<rust_core::stored_records::StoredRecordAction> for TranStoredRecordAction {
    fn from(action: rust_core::stored_records::StoredRecordAction) -> Self {
        match action {
            rust_core::stored_records::StoredRecordAction::Use => Self::Use,
            rust_core::stored_records::StoredRecordAction::Upgrade => Self::Upgrade,
            rust_core::stored_records::StoredRecordAction::Discard => Self::Discard,
        }
    }
}

impl From<TranStoredRecordAction> for rust_core::stored_records::StoredRecordAction {
    fn from(action: TranStoredRecordAction) -> Self {
        match action {
            TranStoredRecordAction::Use => Self::Use,
            TranStoredRecordAction::Upgrade => Self::Upgrade,
            TranStoredRecordAction::Discard => Self::Discard,
        }
    }
}

/// Current session vault record schema version.
#[uniffi::export]
pub fn tran_stored_session_schema() -> u32 {
    CURRENT_SESSION_SCHEMA
}

/// Current push registration record schema version.
#[uniffi::export]
pub fn tran_stored_push_schema() -> u32 {
    CURRENT_PUSH_SCHEMA
}

/// Current remote config record schema version.
#[uniffi::export]
pub fn tran_stored_config_schema() -> u32 {
    CURRENT_CONFIG_SCHEMA
}

/// Decides whether to use, upgrade or discard a stored record version (REQ-DB-011).
#[uniffi::export]
pub fn tran_stored_record_decision(schema: u32, current: u32) -> TranStoredRecordAction {
    stored_record(schema, current).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniffi_stored_record_constants_and_decisions() {
        assert_eq!(tran_stored_session_schema(), 2);
        assert_eq!(tran_stored_push_schema(), 2);
        assert_eq!(tran_stored_config_schema(), 2);

        assert_eq!(
            tran_stored_record_decision(2, 2),
            TranStoredRecordAction::Use
        );
        assert_eq!(
            tran_stored_record_decision(1, 2),
            TranStoredRecordAction::Upgrade
        );
        assert_eq!(
            tran_stored_record_decision(3, 2),
            TranStoredRecordAction::Discard
        );
    }

    #[test]
    fn uniffi_action_conversions() {
        assert_eq!(
            rust_core::stored_records::StoredRecordAction::from(TranStoredRecordAction::Use),
            rust_core::stored_records::StoredRecordAction::Use
        );
        assert_eq!(
            rust_core::stored_records::StoredRecordAction::from(TranStoredRecordAction::Upgrade),
            rust_core::stored_records::StoredRecordAction::Upgrade
        );
        assert_eq!(
            rust_core::stored_records::StoredRecordAction::from(TranStoredRecordAction::Discard),
            rust_core::stored_records::StoredRecordAction::Discard
        );
    }
}
