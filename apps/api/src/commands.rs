//! What the `api` binary does, by its arguments (REQ-DB-003, REQ-DB-009, docs/PERSISTENCE.md):
//!
//! - no arguments: serve ([`crate::run_server`]);
//! - `migrate`: apply pending migrations and exit; `migrate --check`: exit 1 when any are pending,
//!   changing nothing;
//! - `prune`: delete expired rows once and exit;
//! - `send-test-push …`: ring one device by hand ([`crate::push::manual`]).
//!
//! `main.rs` only logs what these answer and exits with [`Failure::exit_code`].

use std::sync::Arc;

use crate::clock::SystemClock;
use crate::config::AppConfig;
use crate::db::migrate::MigrationError;
use crate::db::prune::{run_once, PruneReport};
use crate::db::{Database, DB_POLICY};
use crate::push::manual;
use crate::sessions::Sessions;

/// How to call the binary, for an error message.
pub const USAGE: &str =
    "usage: api [migrate [--check] | prune | send-test-push …] (no arguments: serve)";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Serve,
    Migrate { check: bool },
    Prune,
    SendTestPush,
}

/// Reads the arguments after the binary's name.
pub fn parse(args: &[String]) -> Result<Command, &'static str> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        [] => Ok(Command::Serve),
        ["migrate"] => Ok(Command::Migrate { check: false }),
        ["migrate", "--check"] => Ok(Command::Migrate { check: true }),
        ["prune"] => Ok(Command::Prune),
        [first, ..] if *first == manual::COMMAND => Ok(Command::SendTestPush),
        _ => Err(USAGE),
    }
}

/// A command that did not succeed: what to say, and the process's exit code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    /// 1: `migrate --check` found pending migrations; 2: anything else.
    pub exit_code: i32,
    pub message: String,
}

impl Failure {
    fn new(message: impl Into<String>) -> Self {
        Self {
            exit_code: 2,
            message: message.into(),
        }
    }
}

impl From<MigrationError> for Failure {
    fn from(error: MigrationError) -> Self {
        Self::new(error.to_string())
    }
}

/// Opens the configured database, without migrating it.
pub fn open(config: &AppConfig) -> Result<Database, Failure> {
    let location = config.database().map_err(Failure::new)?;
    Database::open(&location, &DB_POLICY)
        .map_err(|error| Failure::new(format!("could not open the database: {error}")))
}

/// Makes `db` ready to serve: applies pending migrations when `migrate` is set, otherwise
/// refuses while any are pending. Either way a changed, unknown or skipped migration refuses.
pub fn ready(db: &Database, migrate: bool) -> Result<(), Failure> {
    if migrate {
        db.migrate()?;
        return Ok(());
    }
    let status = db.migration_status()?;
    if status.pending > 0 {
        return Err(Failure::new(format!(
            "{} migration(s) pending; run `api migrate` before starting the server \
             (MIGRATE_ON_START is off outside development and test)",
            status.pending
        )));
    }
    Ok(())
}

/// The database the server runs on: opened, then made [`ready`] as `MIGRATE_ON_START` says.
pub fn database_for_serving(config: &AppConfig) -> Result<Database, Failure> {
    let migrate = config.migrate_on_start().map_err(Failure::new)?;
    let db = open(config)?;
    ready(&db, migrate)?;
    Ok(db)
}

/// `api migrate [--check]`: what to log on success.
pub fn migrate(config: &AppConfig, check: bool) -> Result<String, Failure> {
    let db = open(config)?;
    if !check {
        let applied = db.migrate()?;
        return Ok(format!(
            "{applied} migration(s) applied; the schema is current"
        ));
    }
    let status = db.migration_status()?;
    if status.pending > 0 {
        return Err(Failure {
            exit_code: 1,
            message: format!("{} migration(s) pending; run `api migrate`", status.pending),
        });
    }
    Ok(format!(
        "the schema is current: {} migration(s) applied",
        status.applied
    ))
}

/// `api prune`: deletes expired rows once, on the real clock, and logs the counts. Refuses while
/// migrations are pending.
pub async fn prune(config: &AppConfig) -> Result<PruneReport, Failure> {
    let db = open(config)?;
    ready(&db, false)?;
    run_once(&Sessions::sql(db, Arc::new(SystemClock)))
        .await
        .map_err(|error| Failure::new(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(raw: &[&str]) -> Vec<String> {
        raw.iter().map(|arg| arg.to_string()).collect()
    }

    // Verifies: REQ-DB-003 REQ-DB-009
    #[test]
    fn arguments_name_one_command() {
        assert_eq!(parse(&args(&[])), Ok(Command::Serve));
        assert_eq!(
            parse(&args(&["migrate"])),
            Ok(Command::Migrate { check: false })
        );
        assert_eq!(
            parse(&args(&["migrate", "--check"])),
            Ok(Command::Migrate { check: true })
        );
        assert_eq!(parse(&args(&["prune"])), Ok(Command::Prune));
        assert_eq!(
            parse(&args(&["send-test-push", "--platform", "ios"])),
            Ok(Command::SendTestPush)
        );
        for wrong in [&["serve"][..], &["migrate", "--force"], &["prune", "now"]] {
            assert_eq!(parse(&args(wrong)), Err(USAGE), "{wrong:?}");
        }
    }
}
