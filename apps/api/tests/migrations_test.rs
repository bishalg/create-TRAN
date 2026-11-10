// Verifies: REQ-DB-002 REQ-DB-003 REQ-DB-004
//! Migrations against real file databases: the committed schema snapshot, every file embedded,
//! two processes migrating at once, `api migrate [--check]`, and a server that refuses to start on
//! pending, changed or unknown migrations. The runner's own rules (order, checksums, gaps, rollback
//! of a failed migration) are unit tests in `src/db/migrate.rs`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::PathBuf;
use std::sync::{Arc, Barrier};

use api::commands::{self, Failure};
use api::config::AppConfig;
use api::db::migrate::{self, MigrationError, Status, FILES};
use api::db::{Database, DbPolicy, StoreError, DB_POLICY};
use api::run_server;
use support::db::TempDb;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

// Verifies: REQ-DB-004
#[test]
fn schema_snapshot_is_current() {
    let snapshot = migrate::snapshot(&Database::in_memory()).unwrap();
    let path = root().join("schema.sql");
    if std::env::var("TRAN_SCHEMA_SNAPSHOT").as_deref() == Ok("write") {
        std::fs::write(&path, &snapshot).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == snapshot,
        "apps/api/schema.sql is stale: run `pnpm schema:snapshot` and review the diff"
    );
    assert!(snapshot.starts_with(migrate::SNAPSHOT_HEADER));
    assert!(snapshot.contains("CREATE TABLE schema_migrations"));
}

// Verifies: REQ-DB-002
#[test]
fn every_file_in_the_migrations_folder_is_embedded_in_order() {
    let mut on_disk: Vec<String> = std::fs::read_dir(root().join("migrations"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    on_disk.sort();
    let embedded: Vec<String> = FILES
        .iter()
        .map(|(file, _)| format!("{file}.sql"))
        .collect();
    assert_eq!(on_disk, embedded);
    for (file, sql) in FILES {
        let text = std::fs::read_to_string(root().join(format!("migrations/{file}.sql"))).unwrap();
        assert_eq!(&text, sql, "{file}");
    }
    assert_eq!(migrate::embedded().unwrap().len(), FILES.len());
}

// Verifies: REQ-DB-003
#[test]
fn two_processes_migrating_at_once_apply_each_migration_once() {
    for _ in 0..10 {
        let file = TempDb::new();
        let barrier = Arc::new(Barrier::new(2));
        let racers: Vec<_> = (0..2)
            .map(|_| {
                let (barrier, db) = (barrier.clone(), file.open_with(&api::db::DB_POLICY));
                std::thread::spawn(move || {
                    barrier.wait();
                    db.migrate()
                })
            })
            .collect();
        let applied: usize = racers
            .into_iter()
            .map(|racer| racer.join().unwrap().unwrap())
            .sum();
        assert_eq!(applied, FILES.len(), "each migration applied exactly once");
        let recorded: i64 = file
            .raw()
            .query_row("SELECT count(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(recorded, i64::try_from(FILES.len()).unwrap());
    }
}

// Verifies: REQ-DB-003
#[test]
fn migrate_check_reports_pending_migrations_and_changes_nothing() {
    let file = TempDb::new();
    let config = file.config(&[]);
    let pending = commands::migrate(&config, true).unwrap_err();
    assert_eq!(pending.exit_code, 1);
    assert_eq!(
        pending.message,
        format!("{} migration(s) pending; run `api migrate`", FILES.len())
    );
    let objects: i64 = file
        .raw()
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
        .unwrap();
    assert_eq!(objects, 0, "--check created nothing");

    assert_eq!(
        commands::migrate(&config, false),
        Ok(format!(
            "{} migration(s) applied; the schema is current",
            FILES.len()
        ))
    );
    assert_eq!(
        commands::migrate(&config, true),
        Ok(format!(
            "the schema is current: {} migration(s) applied",
            FILES.len()
        ))
    );
    assert_eq!(
        commands::migrate(&config, false),
        Ok("0 migration(s) applied; the schema is current".to_string())
    );
}

/// What `run_server` says when it refuses to start.
async fn refusal(config: AppConfig) -> String {
    let error = run_server(config).await.unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
    error.to_string()
}

// Verifies: REQ-DB-003
#[tokio::test]
async fn outside_development_the_server_refuses_pending_migrations() {
    let file = TempDb::new();
    let production = file.config(&[("APP_ENV", "production"), ("PORT", "0")]);
    let message = refusal(production).await;
    assert!(
        message.contains("run `api migrate` before starting"),
        "{message}"
    );
    assert!(!message.contains("CREATE"), "{message}");

    let forced = file.config(&[("APP_ENV", "production"), ("MIGRATE_ON_START", "true")]);
    let db = commands::database_for_serving(&forced).unwrap();
    assert_eq!(
        db.migration_status(),
        Ok(Status {
            applied: FILES.len(),
            pending: 0
        })
    );
    let migrated = file.config(&[("APP_ENV", "production")]);
    assert!(commands::database_for_serving(&migrated).is_ok());
}

// Verifies: REQ-DB-001 REQ-DB-003
#[tokio::test]
async fn a_bad_database_setting_stops_start_up_naming_the_variable() {
    let wrong = AppConfig::from_lookup(|key| match key {
        "DATABASE_URL" => Some("postgres://user:SENTINEL@host/db".into()),
        _ => None,
    });
    let message = refusal(wrong).await;
    assert!(
        message.contains("DATABASE_URL") && !message.contains("SENTINEL"),
        "{message}"
    );

    let undecided = AppConfig::from_lookup(|key| match key {
        "DATABASE_URL" => Some("sqlite::memory:".into()),
        "MIGRATE_ON_START" => Some("maybe".into()),
        _ => None,
    });
    assert_eq!(
        refusal(undecided).await,
        "MIGRATE_ON_START must be true or false"
    );

    let under_a_file = AppConfig::from_lookup(|key| {
        (key == "DATABASE_URL").then(|| "sqlite:/dev/null/api.sqlite3".to_string())
    });
    assert_eq!(
        commands::open(&under_a_file).unwrap_err(),
        Failure {
            exit_code: 2,
            message: "could not open the database: the database failed".into()
        }
    );
    assert_eq!(
        commands::migrate(&under_a_file, true)
            .unwrap_err()
            .exit_code,
        2
    );
    assert_eq!(
        commands::prune(&under_a_file).await.unwrap_err().exit_code,
        2
    );
}

// Verifies: REQ-DB-003 REQ-DB-008
#[test]
fn migrating_waits_at_most_the_busy_timeout_for_another_process() {
    let file = TempDb::new();
    file.open();
    let other_process = file.raw();
    other_process.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let impatient = file.open_with(&DbPolicy {
        busy_timeout_ms: 50,
        ..DB_POLICY
    });
    assert_eq!(
        impatient.migrate(),
        Err(MigrationError::Store(StoreError::Busy))
    );
    other_process.execute_batch("ROLLBACK").unwrap();
    assert_eq!(impatient.migrate(), Ok(0));
}

// Verifies: REQ-DB-002
#[test]
fn a_changed_or_a_newer_schema_stops_start_up_with_a_clear_message() {
    let file = TempDb::new();
    file.open();
    let config = file.config(&[("APP_ENV", "production")]);

    file.raw()
        .execute("UPDATE schema_migrations SET checksum = 'edited'", [])
        .unwrap();
    let changed = commands::database_for_serving(&config).unwrap_err();
    let migrating = commands::database_for_serving(&file.config(&[])).unwrap_err();
    assert_eq!(migrating, changed, "migrating on start refuses it too");
    assert_eq!(changed.exit_code, 2);
    assert!(
        changed.message.starts_with(&format!(
            "migration {} was changed after it was applied",
            FILES[0].0
        )),
        "{}",
        changed.message
    );

    let fresh = TempDb::new();
    fresh.open();
    fresh
        .raw()
        .execute(
            "INSERT INTO schema_migrations VALUES (99, 'from_the_future', 'x')",
            [],
        )
        .unwrap();
    let newer = commands::migrate(&fresh.config(&[]), false).unwrap_err();
    assert!(
        newer
            .message
            .starts_with("the database has migration 0099_from_the_future"),
        "{}",
        newer.message
    );
    let checked = commands::migrate(&fresh.config(&[]), true).unwrap_err();
    assert_eq!(checked.exit_code, 2);
}
