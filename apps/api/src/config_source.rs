//! Remote configuration source trait and file-backed implementation (spec 029, ADR-0048).
//!
//! Verifies: REQ-CFG-002 REQ-CFG-004

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

use chrono::{DateTime, Duration, Utc};
use rust_core::flags::{find_flag, Rule, CONFIG_POLICY};
use serde::Deserialize;

use crate::clock::Clock;

/// A source of feature flag rules and configuration versions.
pub trait ConfigSource: Send + Sync {
    /// Returns the active targeting rules mapping flag ID -> list of rules.
    fn rules(&self) -> HashMap<String, Vec<Rule>>;

    /// Returns the current configuration version.
    fn config_version(&self) -> u64;
}

/// JSON rule file structure (REQ-CFG-004).
#[derive(Debug, Clone, Deserialize)]
pub struct RuleFile {
    #[serde(default)]
    pub flags: HashMap<String, Vec<Rule>>,
}

#[derive(Debug)]
struct FileConfigSourceInner {
    last_good_rules: HashMap<String, Vec<Rule>>,
    config_version: u64,
    last_checked_at: Option<DateTime<Utc>>,
    last_modified: Option<SystemTime>,
    last_error: Option<String>,
}

/// File-backed configuration source reading `REMOTE_CONFIG_PATH` (REQ-CFG-004).
#[derive(Debug)]
pub struct FileConfigSource {
    path: Option<PathBuf>,
    clock: Arc<dyn Clock>,
    inner: Mutex<FileConfigSourceInner>,
}

impl FileConfigSource {
    /// Creates a new [`FileConfigSource`] with the given file path and injected clock.
    pub fn new(path: Option<PathBuf>, clock: Arc<dyn Clock>) -> Self {
        Self {
            path,
            clock,
            inner: Mutex::new(FileConfigSourceInner {
                last_good_rules: HashMap::new(),
                config_version: 1,
                last_checked_at: None,
                last_modified: None,
                last_error: None,
            }),
        }
    }

    /// Creates an in-memory configuration source with fixed rules, useful for tests.
    pub fn with_rules(rules: HashMap<String, Vec<Rule>>, clock: Arc<dyn Clock>) -> Self {
        Self {
            path: None,
            clock,
            inner: Mutex::new(FileConfigSourceInner {
                last_good_rules: rules,
                config_version: 1,
                last_checked_at: None,
                last_modified: None,
                last_error: None,
            }),
        }
    }

    fn reload_if_needed(&self, inner: &mut FileConfigSourceInner) {
        let Some(path) = &self.path else {
            return;
        };

        let now = self.clock.now();
        if let Some(last_checked) = inner.last_checked_at {
            let max_age = Duration::seconds(CONFIG_POLICY.max_age_seconds as i64);
            if now < last_checked + max_age {
                return;
            }
        }
        inner.last_checked_at = Some(now);

        let metadata = match fs::metadata(path) {
            Ok(m) => m,
            Err(e) => {
                let err_msg = format!("Cannot read metadata for {}: {e}", path.display());
                if inner.last_error.as_deref() != Some(&err_msg) {
                    tracing::warn!("{err_msg}");
                    inner.last_error = Some(err_msg);
                }
                return;
            }
        };

        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if inner.last_modified == Some(modified) {
            return;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("Cannot read file {}: {e}", path.display());
                if inner.last_error.as_deref() != Some(&err_msg) {
                    tracing::warn!("{err_msg}");
                    inner.last_error = Some(err_msg);
                }
                return;
            }
        };

        let parsed: RuleFile = match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(e) => {
                let err_msg = format!("Failed to parse rule file {}: {e}", path.display());
                if inner.last_error.as_deref() != Some(&err_msg) {
                    tracing::warn!("{err_msg}");
                    inner.last_error = Some(err_msg);
                }
                return;
            }
        };

        for flag_id in parsed.flags.keys() {
            if find_flag(flag_id).is_none() {
                let err_msg = format!(
                    "Rule file {} references unknown flag '{flag_id}'",
                    path.display()
                );
                if inner.last_error.as_deref() != Some(&err_msg) {
                    tracing::warn!("{err_msg}");
                    inner.last_error = Some(err_msg);
                }
                return;
            }
        }

        inner.last_good_rules = parsed.flags;
        inner.config_version += 1;
        inner.last_modified = Some(modified);
        inner.last_error = None;
    }
}

impl ConfigSource for FileConfigSource {
    fn rules(&self) -> HashMap<String, Vec<Rule>> {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        self.reload_if_needed(&mut inner);
        inner.last_good_rules.clone()
    }

    fn config_version(&self) -> u64 {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        self.reload_if_needed(&mut inner);
        inner.config_version
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::ManualClock;
    use rust_core::flags::{FlagValue, FLAG_NOTIFY_ME};

    #[test]
    fn file_config_source_no_path_returns_empty_rules_and_version_one() {
        // Verifies: REQ-CFG-004
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let source = FileConfigSource::new(None, clock);
        assert!(source.rules().is_empty());
        assert_eq!(source.config_version(), 1);
    }

    #[test]
    fn file_config_source_reads_valid_file_and_ignores_unknown_flag_or_malformed_json() {
        // Verifies: REQ-CFG-004
        let dir = std::env::temp_dir().join(format!("tran-config-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("flags.json");
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));

        fs::write(
            &path,
            r#"{
                "flags": {
                    "notify_me": [
                        { "rollout": 100, "value": true }
                    ]
                }
            }"#,
        )
        .unwrap();

        let source = FileConfigSource::new(Some(path.clone()), clock.clone());
        let rules = source.rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(
            rules.get(FLAG_NOTIFY_ME).unwrap()[0].value,
            FlagValue::Boolean(true)
        );
        let v1 = source.config_version();

        // Advance clock without touching file: modified timestamp matches
        clock.advance(Duration::seconds(305));
        let rules_same_file = source.rules();
        assert_eq!(rules_same_file.len(), 1);

        // Writing invalid JSON leaves last good rules in force
        fs::write(&path, "malformed JSON {{{{").unwrap();
        clock.advance(Duration::seconds(305));
        let rules_after_bad = source.rules();
        assert_eq!(rules_after_bad.len(), 1);
        assert_eq!(source.config_version(), v1);

        // Repeated query with same error suppresses duplicate warning
        clock.advance(Duration::seconds(305));
        assert_eq!(source.rules().len(), 1);

        // Writing unknown flag leaves last good rules in force
        fs::write(
            &path,
            r#"{
                "flags": {
                    "unrecognized_flag_xyz": [
                        { "rollout": 100, "value": true }
                    ]
                }
            }"#,
        )
        .unwrap();
        clock.advance(Duration::seconds(305));
        let rules_after_unknown = source.rules();
        assert_eq!(rules_after_unknown.len(), 1);
        assert_eq!(source.config_version(), v1);

        // Repeated unknown flag suppresses duplicate warning
        clock.advance(Duration::seconds(305));
        assert_eq!(source.rules().len(), 1);
    }

    #[test]
    fn file_config_source_handles_missing_file_and_with_rules_constructor() {
        // Verifies: REQ-CFG-004
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let missing_path = PathBuf::from("/non/existent/path/to/flags.json");
        let source = FileConfigSource::new(Some(missing_path), clock.clone());
        assert!(source.rules().is_empty());
        // Second check with same missing file suppresses duplicate warning
        clock.advance(Duration::seconds(305));
        assert!(source.rules().is_empty());

        let mut fixed_rules = HashMap::new();
        fixed_rules.insert(
            FLAG_NOTIFY_ME.to_string(),
            vec![Rule {
                platform: None,
                min_version: None,
                rollout: 100,
                value: FlagValue::Boolean(true),
            }],
        );
        let mem_source = FileConfigSource::with_rules(fixed_rules, clock.clone());
        assert_eq!(mem_source.rules().len(), 1);
        assert_eq!(mem_source.config_version(), 1);

        // Path is a directory: metadata succeeds, but read_to_string fails
        let temp_dir = std::env::temp_dir();
        let dir_source = FileConfigSource::new(Some(temp_dir), clock.clone());
        assert!(dir_source.rules().is_empty());
        // Second check with directory suppresses duplicate warning
        clock.advance(Duration::seconds(305));
        assert!(dir_source.rules().is_empty());
    }
}
