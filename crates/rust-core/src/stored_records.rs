// Verifies: REQ-DB-011 REQ-DB-012
//! Client stored-record versions (spec 030, ADR-0049).
//!
//! Every record a device keeps (session vault, push registration, remote config cache) carries a
//! `schema` number. This module holds the two rules every platform applies when it reads one:
//! [`stored_schema`] (which `schema` values are readable at all) and [`stored_record`] (use,
//! upgrade or discard a readable version). Field mapping is per platform: each platform's real
//! store is driven with `fixtures/stored-records.json` to prove it.

/// The current schema versions for device storage records.
pub const CURRENT_SESSION_SCHEMA: u32 = 2;
pub const CURRENT_PUSH_SCHEMA: u32 = 2;
pub const CURRENT_CONFIG_SCHEMA: u32 = 2;

/// The version of a record written before records carried `schema` (the first release).
pub const LEGACY_SCHEMA: u32 = 1;

/// What the client does with a readable stored record version (REQ-DB-011).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoredRecordAction {
    /// The schema matches current; use the record as is.
    Use,
    /// The schema is from an older release; read it into the current shape. Nothing is written
    /// back: the next ordinary write stores the current version.
    Upgrade,
    /// The schema is newer than this build understands: treat the record as absent and leave it
    /// in place for the version that wrote it (REQ-DB-012). Only an unreadable record is deleted.
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

/// The version a stored record's `schema` value names (REQ-DB-011).
///
/// `None` (no `schema` key) is the unversioned first release, [`LEGACY_SCHEMA`]. A present value
/// must be a whole JSON number from 1 to `u32::MAX`; anything else (a string, a negative or
/// fractional number, 0, a number beyond 32 bits, `null`) makes the record unreadable, and this
/// returns `None`. Every platform's reader applies the same rule (`fixtures/stored-records.json`).
pub fn stored_schema(value: Option<&serde_json::Value>) -> Option<u32> {
    match value {
        None => Some(LEGACY_SCHEMA),
        Some(value) => value
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .filter(|&n| n > 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
    fn a_missing_schema_is_the_legacy_version() {
        assert_eq!(stored_schema(None), Some(LEGACY_SCHEMA));
    }

    #[test]
    fn a_whole_number_in_range_is_its_version() {
        assert_eq!(stored_schema(Some(&json!(1))), Some(1));
        assert_eq!(stored_schema(Some(&json!(2))), Some(2));
        assert_eq!(stored_schema(Some(&json!(u32::MAX))), Some(u32::MAX));
    }

    #[test]
    fn any_other_present_schema_is_unreadable() {
        for value in [
            json!("2"),
            json!(-1),
            json!(1.5),
            json!(2.0),
            json!(0),
            json!(u64::from(u32::MAX) + 1),
            json!(4_294_967_298_u64),
            json!(null),
            json!(true),
            json!([2]),
            json!({ "v": 2 }),
        ] {
            assert_eq!(stored_schema(Some(&value)), None, "{value}");
        }
    }
}
