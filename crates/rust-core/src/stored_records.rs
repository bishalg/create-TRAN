// Verifies: REQ-DB-011 REQ-DB-012
//! Client stored-record versioning and migration logic (spec 030, ADR-0049).
//!
//! Reading any stored record (session vault, push preferences, remote config) goes through
//! [`stored_record`]. A current record is used directly; an older record is upgraded by a pure
//! function; a newer or malformed record is discarded and treated as absent, never a crash.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The current schema versions for device storage records.
pub const CURRENT_SESSION_SCHEMA: u32 = 2;
pub const CURRENT_PUSH_SCHEMA: u32 = 2;
pub const CURRENT_CONFIG_SCHEMA: u32 = 2;

/// What the client does with a stored record version (REQ-DB-011).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredRecordAction {
    /// The schema matches current; use the record as is.
    Use,
    /// The schema is from an older release; upgrade it to the current schema.
    Upgrade,
    /// The schema is newer than understood or invalid (0); discard and treat as absent.
    Discard,
}

impl StoredRecordAction {
    /// Wire name matching `fixtures/stored-records.json`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Use => "use",
            Self::Upgrade => "upgrade",
            Self::Discard => "discard",
        }
    }
}

/// The one decision every client makes when reading a stored record (REQ-DB-011).
pub const fn stored_record(schema: u32, current: u32) -> StoredRecordAction {
    if schema == 0 || current == 0 {
        StoredRecordAction::Discard
    } else if schema == current {
        StoredRecordAction::Use
    } else if schema < current {
        StoredRecordAction::Upgrade
    } else {
        StoredRecordAction::Discard
    }
}

/// Stored session vault record on device (REQ-SEC-017, REQ-DB-011, REQ-DB-012).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredSessionRecord {
    pub schema: u32,
    pub user_id: String,
    pub role: String,
    pub refresh_token: String,
}

/// Stored push notification registration record on device (REQ-PSH-010, REQ-DB-011).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredPushRecord {
    pub schema: u32,
    pub token: String,
    pub registered_at_unix_s: i64,
}

/// Stored client version thresholds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct StoredClientThresholds {
    #[serde(default)]
    pub minimum_version: Option<String>,
    #[serde(default)]
    pub recommended_version: Option<String>,
}

/// Stored remote configuration cache record on device (REQ-CFG-005, REQ-DB-011).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredConfigRecord {
    pub schema: u32,
    pub flags: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub client: Option<StoredClientThresholds>,
    pub config_version: i64,
}

/// Read and optionally upgrade a session vault record from raw JSON (REQ-DB-011, REQ-DB-012).
pub fn read_stored_session(raw: &str, current_schema: u32) -> Option<StoredSessionRecord> {
    let json: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = json.as_object()?;

    // Unversioned legacy records default to schema 1.
    let schema = match obj.get("schema") {
        Some(v) => v.as_u64()? as u32,
        None => 1,
    };

    let user_id = obj.get("user_id")?.as_str()?.to_string();
    let role = obj.get("role")?.as_str()?.to_string();
    let refresh_token = obj.get("refresh_token")?.as_str()?.to_string();

    match stored_record(schema, current_schema) {
        StoredRecordAction::Use => Some(StoredSessionRecord {
            schema,
            user_id,
            role,
            refresh_token,
        }),
        StoredRecordAction::Upgrade => Some(StoredSessionRecord {
            schema: current_schema,
            user_id,
            role,
            refresh_token,
        }),
        StoredRecordAction::Discard => None,
    }
}

/// Read and optionally upgrade a push record from raw JSON (REQ-DB-011).
pub fn read_stored_push(raw: &str, current_schema: u32) -> Option<StoredPushRecord> {
    let json: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = json.as_object()?;

    let schema = match obj.get("schema") {
        Some(v) => v.as_u64()? as u32,
        None => 1,
    };

    let token = obj.get("token")?.as_str()?.to_string();
    let registered_at_unix_s = obj.get("registered_at_unix_s")?.as_i64()?;

    match stored_record(schema, current_schema) {
        StoredRecordAction::Use => Some(StoredPushRecord {
            schema,
            token,
            registered_at_unix_s,
        }),
        StoredRecordAction::Upgrade => Some(StoredPushRecord {
            schema: current_schema,
            token,
            registered_at_unix_s,
        }),
        StoredRecordAction::Discard => None,
    }
}

/// Read and optionally upgrade a cached configuration record from raw JSON (REQ-DB-011).
pub fn read_stored_config(raw: &str, current_schema: u32) -> Option<StoredConfigRecord> {
    let json: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = json.as_object()?;

    let schema = match obj.get("schema") {
        Some(v) => v.as_u64()? as u32,
        None => 1,
    };

    let flags_val = obj.get("flags")?;
    let flags_map = flags_val.as_object()?;
    let mut flags = HashMap::new();
    for (k, v) in flags_map {
        flags.insert(k.clone(), v.clone());
    }
    let client = obj
        .get("client")
        .and_then(|c| serde_json::from_value(c.clone()).ok());
    let config_version = obj.get("config_version")?.as_i64()?;

    match stored_record(schema, current_schema) {
        StoredRecordAction::Use => Some(StoredConfigRecord {
            schema,
            flags,
            client,
            config_version,
        }),
        StoredRecordAction::Upgrade => Some(StoredConfigRecord {
            schema: current_schema,
            flags,
            client,
            config_version,
        }),
        StoredRecordAction::Discard => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stored_record_action_as_str() {
        assert_eq!(StoredRecordAction::Use.as_str(), "use");
        assert_eq!(StoredRecordAction::Upgrade.as_str(), "upgrade");
        assert_eq!(StoredRecordAction::Discard.as_str(), "discard");
    }

    #[test]
    fn test_stored_record_decisions() {
        assert_eq!(stored_record(1, 1), StoredRecordAction::Use);
        assert_eq!(stored_record(2, 2), StoredRecordAction::Use);
        assert_eq!(stored_record(1, 2), StoredRecordAction::Upgrade);
        assert_eq!(stored_record(3, 2), StoredRecordAction::Discard);
        assert_eq!(stored_record(0, 2), StoredRecordAction::Discard);
        assert_eq!(stored_record(1, 0), StoredRecordAction::Discard);
        assert_eq!(stored_record(0, 0), StoredRecordAction::Discard);
    }

    #[test]
    fn test_read_stored_session() {
        // Valid v2 record
        let v2 = r#"{"schema":2,"user_id":"u1","role":"citizen_voter","refresh_token":"tok1"}"#;
        let read = read_stored_session(v2, 2).expect("should parse v2");
        assert_eq!(read.schema, 2);
        assert_eq!(read.user_id, "u1");
        assert_eq!(read.role, "citizen_voter");
        assert_eq!(read.refresh_token, "tok1");

        // Upgrade v1 record
        let v1 = r#"{"schema":1,"user_id":"u1","role":"citizen_voter","refresh_token":"tok1"}"#;
        let upgraded = read_stored_session(v1, 2).expect("should upgrade v1");
        assert_eq!(upgraded.schema, 2);

        // Upgrade legacy record without schema
        let v0 = r#"{"user_id":"u1","role":"citizen_voter","refresh_token":"tok1"}"#;
        let upgraded_v0 = read_stored_session(v0, 2).expect("should upgrade unversioned");
        assert_eq!(upgraded_v0.schema, 2);

        // Discard future version
        let v3 = r#"{"schema":3,"user_id":"u1","role":"citizen_voter","refresh_token":"tok1"}"#;
        assert!(read_stored_session(v3, 2).is_none());

        // Discard corrupt
        assert!(read_stored_session("not json", 2).is_none());
        assert!(read_stored_session("[]", 2).is_none());
        assert!(read_stored_session(r#"{"schema":"not-a-number"}"#, 2).is_none());
        assert!(read_stored_session(r#"{"schema":2}"#, 2).is_none());
        assert!(read_stored_session(r#"{"schema":2,"user_id":"u"}"#, 2).is_none());
        assert!(read_stored_session(r#"{"schema":2,"user_id":"u","role":"r"}"#, 2).is_none());
        assert!(read_stored_session(
            r#"{"schema":2,"user_id":123,"role":"r","refresh_token":"t"}"#,
            2
        )
        .is_none());
        assert!(read_stored_session(
            r#"{"schema":2,"user_id":"u","role":123,"refresh_token":"t"}"#,
            2
        )
        .is_none());
        assert!(read_stored_session(
            r#"{"schema":2,"user_id":"u","role":"r","refresh_token":123}"#,
            2
        )
        .is_none());
    }

    #[test]
    fn test_read_stored_push() {
        let v2 = r#"{"schema":2,"token":"t1","registered_at_unix_s":1700000000}"#;
        let read = read_stored_push(v2, 2).expect("should parse v2");
        assert_eq!(read.schema, 2);
        assert_eq!(read.token, "t1");
        assert_eq!(read.registered_at_unix_s, 1700000000);

        let v1 = r#"{"schema":1,"token":"t1","registered_at_unix_s":1700000000}"#;
        let upgraded = read_stored_push(v1, 2).expect("should upgrade v1");
        assert_eq!(upgraded.schema, 2);

        let v0 = r#"{"token":"t0","registered_at_unix_s":1700000000}"#;
        let upgraded_v0 = read_stored_push(v0, 2).expect("should upgrade unversioned");
        assert_eq!(upgraded_v0.schema, 2);

        let v3 = r#"{"schema":3,"token":"t3","registered_at_unix_s":1700000000}"#;
        assert!(read_stored_push(v3, 2).is_none());

        assert!(read_stored_push("not json", 2).is_none());
        assert!(read_stored_push("[]", 2).is_none());
        assert!(read_stored_push(r#"{"schema":"invalid"}"#, 2).is_none());
        assert!(read_stored_push(r#"{"schema":2}"#, 2).is_none());
        assert!(read_stored_push(r#"{"schema":2,"token":"t"}"#, 2).is_none());
        assert!(
            read_stored_push(r#"{"schema":2,"token":123,"registered_at_unix_s":123}"#, 2).is_none()
        );
        assert!(read_stored_push(
            r#"{"schema":2,"token":"t","registered_at_unix_s":"invalid"}"#,
            2
        )
        .is_none());
    }

    #[test]
    fn test_read_stored_config() {
        let v2 = r#"{"schema":2,"flags":{"notify_me":true},"client":{"minimum_version":"1.0.0"},"config_version":5}"#;
        let read = read_stored_config(v2, 2).expect("should parse v2");
        assert_eq!(read.schema, 2);
        assert_eq!(read.config_version, 5);
        assert_eq!(
            read.client
                .as_ref()
                .and_then(|c| c.minimum_version.as_deref()),
            Some("1.0.0")
        );

        let v1 = r#"{"schema":1,"flags":{"notify_me":false},"config_version":3}"#;
        let upgraded = read_stored_config(v1, 2).expect("should upgrade v1");
        assert_eq!(upgraded.schema, 2);
        assert_eq!(upgraded.config_version, 3);
        assert!(upgraded.client.is_none());

        let v0 = r#"{"flags":{"notify_me":false},"config_version":3}"#;
        let upgraded_v0 = read_stored_config(v0, 2).expect("should upgrade unversioned");
        assert_eq!(upgraded_v0.schema, 2);

        let v3 = r#"{"schema":3,"flags":{},"config_version":9}"#;
        assert!(read_stored_config(v3, 2).is_none());

        assert!(read_stored_config("not json", 2).is_none());
        assert!(read_stored_config("[]", 2).is_none());
        assert!(read_stored_config(r#"{"schema":"invalid"}"#, 2).is_none());
        assert!(read_stored_config(r#"{"schema":2}"#, 2).is_none());
        assert!(read_stored_config(r#"{"schema":2,"flags":"not-object"}"#, 2).is_none());
        assert!(read_stored_config(r#"{"schema":2,"flags":{}}"#, 2).is_none());
        assert!(
            read_stored_config(r#"{"schema":2,"flags":{},"config_version":"invalid"}"#, 2)
                .is_none()
        );
    }
}
