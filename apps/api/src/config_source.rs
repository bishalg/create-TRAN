//! Remote configuration source trait and file-backed implementation (spec 029, ADR-0048).
//!
//! Verifies: REQ-CFG-002 REQ-CFG-004

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use chrono::{DateTime, Duration, Utc};
use rust_core::flags::{find_flag, Rule, CONFIG_POLICY};
use serde::Deserialize;
use sha2::{Digest, Sha256};

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

/// The version of "no rules": no file configured, or the file is gone.
pub const NO_RULES_VERSION: u64 = 1;

/// The version of a rule file: the first 48 bits of the SHA-256 of its bytes, so every replica
/// and every restart serving the same file agrees, and a JSON number carries it exactly. Never
/// [`NO_RULES_VERSION`].
pub fn content_version(content: &[u8]) -> u64 {
    let hash = Sha256::digest(content);
    let version = hash[..6]
        .iter()
        .fold(0u64, |acc, byte| (acc << 8) | u64::from(*byte));
    version.max(NO_RULES_VERSION + 1)
}

/// `api check-config`: the file named by `REMOTE_CONFIG_PATH` exists and parses. A rule naming an
/// unknown flag passes: the server ignores it, which is what a deploy removing a flag needs.
pub fn check_file(path: &Path) -> Result<(), String> {
    let content = fs::read(path)
        .map_err(|_| "REMOTE_CONFIG_PATH names a file that cannot be read".to_string())?;
    serde_json::from_slice::<RuleFile>(&content)
        .map(drop)
        .map_err(|_| "REMOTE_CONFIG_PATH names a file that is not a valid rule file".to_string())
}

#[derive(Debug)]
struct FileConfigSourceInner {
    last_good_rules: HashMap<String, Vec<Rule>>,
    config_version: u64,
    last_checked_at: Option<DateTime<Utc>>,
    /// The bytes behind `last_good_rules`, by version; `None` while no file is in force.
    applied: Option<u64>,
    last_error: Option<String>,
}

impl FileConfigSourceInner {
    fn new(rules: HashMap<String, Vec<Rule>>) -> Self {
        Self {
            last_good_rules: rules,
            config_version: NO_RULES_VERSION,
            last_checked_at: None,
            applied: None,
            last_error: None,
        }
    }

    /// Logs `message` unless it is the problem already reported.
    fn report(&mut self, message: String) {
        if self.last_error.as_deref() != Some(&message) {
            tracing::warn!("{message}");
            self.last_error = Some(message);
        }
    }
}

/// File-backed configuration source reading `REMOTE_CONFIG_PATH` (REQ-CFG-004).
///
/// The file is read at most once per `CONFIG_POLICY.max_age_seconds` and applied when its bytes
/// changed, whatever its timestamp says. A file that is gone means no rules: every flag is its
/// default, as with no file configured. A file that cannot be read or does not parse leaves the
/// last good rules in force; a rule naming an unknown flag is dropped on its own. Each problem is
/// logged once.
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
            inner: Mutex::new(FileConfigSourceInner::new(HashMap::new())),
        }
    }

    /// Creates an in-memory configuration source with fixed rules, useful for tests.
    pub fn with_rules(rules: HashMap<String, Vec<Rule>>, clock: Arc<dyn Clock>) -> Self {
        Self {
            path: None,
            clock,
            inner: Mutex::new(FileConfigSourceInner::new(rules)),
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

        let content = match fs::read(path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                inner.applied = None;
                inner.last_good_rules.clear();
                inner.config_version = NO_RULES_VERSION;
                inner.report(format!(
                    "Rule file {} not found; every flag is its default",
                    path.display()
                ));
                return;
            }
            Err(error) => {
                inner.report(format!("Cannot read file {}: {error}", path.display()));
                return;
            }
        };

        let version = content_version(&content);
        if inner.applied == Some(version) {
            return;
        }

        let parsed: RuleFile = match serde_json::from_slice(&content) {
            Ok(parsed) => parsed,
            Err(error) => {
                inner.report(format!(
                    "Failed to parse rule file {}: {error}",
                    path.display()
                ));
                return;
            }
        };

        let mut rules = parsed.flags;
        let mut unknown: Vec<String> = rules
            .keys()
            .filter(|flag_id| find_flag(flag_id).is_none())
            .cloned()
            .collect();
        unknown.sort();
        let file = path.display().to_string();
        for flag_id in &unknown {
            rules.remove(flag_id);
            tracing::warn!(flag = %flag_id, file = %file, "rule file names an unknown flag; its rules are ignored");
        }

        inner.last_good_rules = rules;
        inner.config_version = version;
        inner.applied = Some(version);
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

    const NOTIFY_ON: &str =
        r#"{ "flags": { "notify_me": [ { "rollout": 100, "value": true } ] } }"#;
    const NOTIFY_OFF: &str = r#"{ "flags": { "notify_me": [ { "rollout": 0, "value": true } ] } }"#;

    fn temp_file() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tran-config-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("flags.json")
    }

    fn next_check(clock: &ManualClock) {
        clock.advance(Duration::seconds(CONFIG_POLICY.max_age_seconds as i64));
    }

    fn rollout(source: &FileConfigSource) -> Option<u8> {
        source
            .rules()
            .get(FLAG_NOTIFY_ME)
            .map(|rules| rules[0].rollout)
    }

    #[test]
    fn file_config_source_no_path_returns_empty_rules_and_version_one() {
        // Verifies: REQ-CFG-004
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let source = FileConfigSource::new(None, clock);
        assert!(source.rules().is_empty());
        assert_eq!(source.config_version(), NO_RULES_VERSION);
    }

    // Verifies: REQ-CFG-002 REQ-CFG-004
    #[test]
    fn the_version_is_the_content_hash_so_replicas_and_restarts_agree() {
        let path = temp_file();
        fs::write(&path, NOTIFY_ON).unwrap();
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let one = FileConfigSource::new(Some(path.clone()), clock.clone());
        let other = FileConfigSource::new(Some(path), clock);
        assert_eq!(one.config_version(), content_version(NOTIFY_ON.as_bytes()));
        assert_eq!(one.config_version(), other.config_version());
        assert_ne!(
            content_version(NOTIFY_ON.as_bytes()),
            content_version(NOTIFY_OFF.as_bytes())
        );
        assert!(content_version(b"") > NO_RULES_VERSION);
        assert!(content_version(NOTIFY_ON.as_bytes()) < 1 << 48);
    }

    // Verifies: REQ-CFG-004
    #[test]
    fn a_changed_file_is_applied_by_its_content_even_with_the_same_timestamp() {
        let path = temp_file();
        fs::write(&path, NOTIFY_ON).unwrap();
        let file = fs::File::options().write(true).open(&path).unwrap();
        let stamp = file.metadata().unwrap().modified().unwrap();
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let source = FileConfigSource::new(Some(path.clone()), clock.clone());
        assert_eq!(rollout(&source), Some(100));
        let v1 = source.config_version();

        // Same length, same mtime (`cp -p`, or an edit within one clock tick).
        fs::write(&path, NOTIFY_ON.replace("100", " 42")).unwrap();
        file.set_modified(stamp).unwrap();
        assert_eq!(rollout(&source), Some(100), "not before max_age");
        next_check(&clock);
        assert_eq!(rollout(&source), Some(42));
        assert_ne!(source.config_version(), v1);

        // Unchanged bytes are not re-applied.
        let v2 = source.config_version();
        next_check(&clock);
        assert_eq!(source.config_version(), v2);
    }

    // Verifies: REQ-CFG-004
    #[test]
    fn a_bad_file_keeps_the_last_good_rules_and_an_unknown_flag_is_dropped_alone() {
        let path = temp_file();
        fs::write(&path, NOTIFY_ON).unwrap();
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let source = FileConfigSource::new(Some(path.clone()), clock.clone());
        assert_eq!(rollout(&source), Some(100));
        let v1 = source.config_version();

        fs::write(&path, "malformed JSON {{{{").unwrap();
        next_check(&clock);
        assert_eq!(rollout(&source), Some(100));
        assert_eq!(source.config_version(), v1);
        next_check(&clock);
        assert_eq!(
            rollout(&source),
            Some(100),
            "the same problem is logged once"
        );

        // The flag removed from the catalogue is ignored; every other rule still applies.
        let with_unknown = r#"{ "flags": {
            "retired_flag": [ { "rollout": 100, "value": true } ],
            "another_retired": [ { "rollout": 100, "value": true } ],
            "notify_me": [ { "rollout": 42, "value": true } ] } }"#;
        fs::write(&path, with_unknown).unwrap();
        next_check(&clock);
        let rules = source.rules();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[FLAG_NOTIFY_ME][0].rollout, 42);
        assert_eq!(rules[FLAG_NOTIFY_ME][0].value, FlagValue::Boolean(true));
        assert_eq!(
            source.config_version(),
            content_version(with_unknown.as_bytes())
        );
    }

    // Verifies: REQ-CFG-004
    #[test]
    fn a_deleted_file_means_every_flag_is_its_default_until_it_returns() {
        let path = temp_file();
        fs::write(&path, NOTIFY_ON).unwrap();
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
        let source = FileConfigSource::new(Some(path.clone()), clock.clone());
        assert_eq!(rollout(&source), Some(100));

        fs::remove_file(&path).unwrap();
        next_check(&clock);
        assert!(source.rules().is_empty());
        assert_eq!(source.config_version(), NO_RULES_VERSION);
        next_check(&clock);
        assert!(source.rules().is_empty());

        fs::write(&path, NOTIFY_ON).unwrap();
        next_check(&clock);
        assert_eq!(rollout(&source), Some(100));
        assert_eq!(
            source.config_version(),
            content_version(NOTIFY_ON.as_bytes())
        );
    }

    #[test]
    fn an_unreadable_path_and_fixed_rules() {
        // Verifies: REQ-CFG-004
        let clock = Arc::new(ManualClock::starting_at(Utc::now()));
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
        assert_eq!(mem_source.config_version(), NO_RULES_VERSION);

        // A directory: it exists, but cannot be read as a file.
        let dir_source = FileConfigSource::new(Some(std::env::temp_dir()), clock.clone());
        assert!(dir_source.rules().is_empty());
        next_check(&clock);
        assert!(dir_source.rules().is_empty());
    }

    // Verifies: REQ-DEP-003 REQ-CFG-004
    #[test]
    fn check_file_names_the_variable_never_the_path() {
        let path = temp_file();
        let missing = check_file(&path).unwrap_err();
        assert!(missing.starts_with("REMOTE_CONFIG_PATH"));
        assert!(!missing.contains("flags.json"));
        fs::write(&path, "{ nope").unwrap();
        let bad = check_file(&path).unwrap_err();
        assert!(bad.starts_with("REMOTE_CONFIG_PATH"));
        fs::write(&path, r#"{ "flags": { "retired_flag": [] } }"#).unwrap();
        assert_eq!(check_file(&path), Ok(()));
    }
}
