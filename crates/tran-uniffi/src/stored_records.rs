//! Client stored record versioning and migration for native apps (spec 030, ADR-0049).
//!
//! Exposes stored record decisions and read/upgrade routines over UniFFI.
//!
//! Verifies: REQ-DB-011 REQ-DB-012

use rust_core::stored_records::{
    read_stored_push, read_stored_session, stored_record, CURRENT_CONFIG_SCHEMA,
    CURRENT_PUSH_SCHEMA, CURRENT_SESSION_SCHEMA,
};

/// What the native app does with a stored record version (REQ-DB-011).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranStoredRecordAction {
    /// The schema matches current; use the record as is.
    Use,
    /// The schema is from an older release; upgrade it to the current schema.
    Upgrade,
    /// The schema is newer than understood or invalid (0); discard and treat as absent.
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

/// Stored session vault record on native device (REQ-SEC-017, REQ-DB-011).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranStoredSessionRecord {
    /// Record schema version.
    pub schema: u32,
    /// User identifier.
    pub user_id: String,
    /// User role wire string.
    pub role: String,
    /// Refresh token credential.
    pub refresh_token: String,
}

/// Stored push notification registration record on native device (REQ-PSH-010, REQ-DB-011).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranStoredPushRecord {
    /// Record schema version.
    pub schema: u32,
    /// Registered push token.
    pub token: String,
    /// Timestamp of last registration in Unix seconds.
    pub registered_at_unix_s: i64,
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

/// Reads and optionally upgrades a stored session vault record (REQ-DB-011, REQ-DB-012).
#[uniffi::export]
pub fn tran_read_stored_session(
    raw_json: String,
    current_schema: u32,
) -> Option<TranStoredSessionRecord> {
    read_stored_session(&raw_json, current_schema).map(|rec| TranStoredSessionRecord {
        schema: rec.schema,
        user_id: rec.user_id,
        role: rec.role,
        refresh_token: rec.refresh_token,
    })
}

/// Reads and optionally upgrades a stored push registration record (REQ-DB-011).
#[uniffi::export]
pub fn tran_read_stored_push(
    raw_json: String,
    current_schema: u32,
) -> Option<TranStoredPushRecord> {
    read_stored_push(&raw_json, current_schema).map(|rec| TranStoredPushRecord {
        schema: rec.schema,
        token: rec.token,
        registered_at_unix_s: rec.registered_at_unix_s,
    })
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

    #[test]
    fn uniffi_read_stored_records() {
        let v1_session =
            r#"{"schema":1,"user_id":"u1","role":"citizen_voter","refresh_token":"tok1"}"#;
        let session =
            tran_read_stored_session(v1_session.to_string(), 2).expect("should upgrade session");
        assert_eq!(session.schema, 2);
        assert_eq!(session.user_id, "u1");
        assert_eq!(session.role, "citizen_voter");
        assert_eq!(session.refresh_token, "tok1");

        let v1_push = r#"{"schema":1,"token":"tok1","registered_at_unix_s":1700000000}"#;
        let push = tran_read_stored_push(v1_push.to_string(), 2).expect("should upgrade push");
        assert_eq!(push.schema, 2);
        assert_eq!(push.token, "tok1");
        assert_eq!(push.registered_at_unix_s, 1700000000);
    }
}
