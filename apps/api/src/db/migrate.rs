//! Forward-only migrations (REQ-DB-002 to REQ-DB-004, ADR-0049).
//!
//! Each file `apps/api/migrations/NNNN_<name>.sql` is embedded in the binary ([`FILES`]), applied
//! in order, each in its own transaction, and recorded in `schema_migrations` with its SHA-256.
//! Before serving, the applied list must be exactly the first migrations of [`FILES`], unchanged:
//! a changed file, a migration this build does not know (a newer database) or a gap stops the
//! server with a message that names the file, never its SQL.
//!
//! Two processes may migrate at once: each migration takes SQLite's write lock first
//! (`BEGIN IMMEDIATE`) and re-reads what is applied under it, so the second process finds the
//! migration done and moves on.

use rusqlite::{Connection, ErrorCode, TransactionBehavior};
use sha2::{Digest, Sha256};

use super::{rows, Database, StoreError};

/// Embeds each named file of `apps/api/migrations/`, in order.
macro_rules! embed {
    ($($file:literal),* $(,)?) => {
        &[$((
            $file,
            include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations/", $file, ".sql")),
        )),*]
    };
}

/// Every migration, in order: `(file name without .sql, its text)`. A file in
/// `apps/api/migrations/` that is not listed here fails `migrations_test`.
pub const FILES: &[(&str, &str)] = embed!["0001_sessions_and_devices"];

/// The runner's own table: what is applied, and the checksum it had.
const BOOKKEEPING: &str = "CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL
)";

/// What `pnpm schema:snapshot` writes above the schema in `apps/api/schema.sql`.
pub const SNAPSHOT_HEADER: &str =
    "-- The schema after every migration in apps/api/migrations, applied to an empty database \
(spec 030 REQ-DB-004).\n-- Generated: do not edit. `pnpm schema:snapshot` rewrites it; \
`cargo test -p api --test migrations_test` fails while it is stale.\n";

/// One embedded migration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Migration {
    pub version: u32,
    /// The file name without `.sql`: `0001_sessions_and_devices`.
    pub file: &'static str,
    pub sql: &'static str,
}

impl Migration {
    /// SHA-256 of the file, lowercase hex: what `schema_migrations` keeps.
    pub fn checksum(&self) -> String {
        Sha256::digest(self.sql.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn name(&self) -> &'static str {
        &self.file[5..]
    }
}

/// Why the schema cannot be used or moved forward. Messages name files and numbers only.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MigrationError {
    #[error("migration file {0}.sql is not named NNNN_<lowercase name>.sql")]
    Misnamed(String),
    #[error(
        "migration files must be numbered 0001, 0002, … without gaps or duplicates: expected \
         {expected:04}, found {found}.sql"
    )]
    OutOfSequence { expected: usize, found: String },
    #[error(
        "migration {0} was changed after it was applied (checksum mismatch); restore the file and \
         fix forward with a new migration"
    )]
    Changed(String),
    #[error(
        "the database has migration {0}, which this build does not know: the database is newer \
         than this version of the API; deploy the newer version"
    )]
    Unknown(String),
    #[error(
        "the database skipped migration {0:04}: applied migrations must be 0001 to the last \
         without gaps"
    )]
    Gap(usize),
    #[error("migration {file} failed and was rolled back (SQLite {code:?})")]
    Failed {
        file: &'static str,
        code: Option<ErrorCode>,
    },
    #[error("{0}")]
    Store(#[from] StoreError),
}

impl From<rusqlite::Error> for MigrationError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

/// Where the database stands against the embedded migrations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Status {
    pub applied: usize,
    pub pending: usize,
}

/// [`FILES`], checked: named `NNNN_<name>` and numbered 1, 2, 3… in order.
pub fn embedded() -> Result<Vec<Migration>, MigrationError> {
    checked(FILES)
}

/// `files`, checked like [`FILES`].
pub fn checked(files: &[(&'static str, &'static str)]) -> Result<Vec<Migration>, MigrationError> {
    files
        .iter()
        .enumerate()
        .map(|(index, &(file, sql))| {
            let well_named = file.len() > 5
                && file.as_bytes()[4] == b'_'
                && file[..4].bytes().all(|b| b.is_ascii_digit())
                && file[5..]
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
            if !well_named {
                return Err(MigrationError::Misnamed(file.to_string()));
            }
            let version: u32 = file[..4].parse().unwrap_or_default();
            if usize::try_from(version) != Ok(index + 1) {
                return Err(MigrationError::OutOfSequence {
                    expected: index + 1,
                    found: file.to_string(),
                });
            }
            Ok(Migration { version, file, sql })
        })
        .collect()
}

/// One row of `schema_migrations`.
struct Applied {
    version: u32,
    name: String,
    checksum: String,
}

/// What `connection` records as applied, by version; nothing before the first migration.
fn applied(connection: &Connection) -> rusqlite::Result<Vec<Applied>> {
    connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
            [],
            |row| row.get::<_, bool>(0),
        )
        .and_then(|exists| {
            if !exists {
                return Ok(Vec::new());
            }
            rows(
                connection,
                "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
                [],
                |row| {
                    <(u32, String, String)>::try_from(row).map(|(version, name, checksum)| Applied {
                        version,
                        name,
                        checksum,
                    })
                },
            )
        })
}

/// How many of `migrations` are applied, if what is applied is exactly the first of them,
/// unchanged.
fn verify(applied: &[Applied], migrations: &[Migration]) -> Result<usize, MigrationError> {
    for (index, row) in applied.iter().enumerate() {
        let Some(known) = migrations.iter().find(|m| m.version == row.version) else {
            return Err(MigrationError::Unknown(format!(
                "{:04}_{}",
                row.version, row.name
            )));
        };
        if usize::try_from(row.version) != Ok(index + 1) {
            return Err(MigrationError::Gap(index + 1));
        }
        if known.checksum() != row.checksum {
            return Err(MigrationError::Changed(known.file.to_string()));
        }
    }
    Ok(applied.len())
}

/// Where `db` stands against `migrations`, changing nothing (`api migrate --check`).
pub fn status_of(db: &Database, migrations: &[Migration]) -> Result<Status, MigrationError> {
    let rows = db.read(applied)?;
    let applied = verify(&rows, migrations)?;
    Ok(Status {
        applied,
        pending: migrations.len() - applied,
    })
}

/// Applies every pending one of `migrations`, each in its own transaction; returns how many this
/// call applied (another process may have applied the rest).
pub fn migrate_with(db: &Database, migrations: &[Migration]) -> Result<usize, MigrationError> {
    db.with_connection(|connection| {
        let mut applied_here = 0;
        while apply_next(connection, migrations)? {
            applied_here += 1;
        }
        Ok(applied_here)
    })
}

/// In one transaction that holds the write lock: re-reads what is applied, then applies and
/// records the first pending migration. `false` when none is pending.
fn apply_next(
    connection: &mut Connection,
    migrations: &[Migration],
) -> Result<bool, MigrationError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let done = transaction
        .execute_batch(BOOKKEEPING)
        .and_then(|()| applied(&transaction))
        .map_err(MigrationError::from)
        .and_then(|rows| verify(&rows, migrations))?;
    let Some(next) = migrations.get(done) else {
        return transaction
            .commit()
            .map(|()| false)
            .map_err(MigrationError::from);
    };
    transaction
        .execute_batch(next.sql)
        .map_err(|error| MigrationError::Failed {
            file: next.file,
            code: error.sqlite_error_code(),
        })?;
    transaction
        .execute(
            "INSERT INTO schema_migrations (version, name, checksum) VALUES (?1, ?2, ?3)",
            (next.version, next.name(), next.checksum()),
        )
        .and_then(|_| transaction.commit())
        .map(|()| true)
        .map_err(MigrationError::from)
}

/// The schema as SQLite holds it, table by table with its indexes after it, under
/// [`SNAPSHOT_HEADER`]: what `apps/api/schema.sql` must equal.
pub fn snapshot(db: &Database) -> Result<String, StoreError> {
    db.read(|connection| {
        rows(
            connection,
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' \
             ORDER BY tbl_name, type = 'index', name",
            [],
            |row| row.get::<_, String>(0),
        )
    })
    .map(|objects| {
        let body: Vec<String> = objects.iter().map(|sql| format!("{sql};\n")).collect();
        format!("{SNAPSHOT_HEADER}\n{}", body.join("\n"))
    })
}

impl Database {
    /// Applies every pending embedded migration (`api migrate`); returns how many.
    pub fn migrate(&self) -> Result<usize, MigrationError> {
        embedded().and_then(|migrations| migrate_with(self, &migrations))
    }

    /// Where the database stands against the embedded migrations, changing nothing.
    pub fn migration_status(&self) -> Result<Status, MigrationError> {
        embedded().and_then(|migrations| status_of(self, &migrations))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::exec;
    use crate::db::{Location, DB_POLICY};

    fn empty() -> Database {
        Database::open(&Location::Memory, &DB_POLICY).unwrap()
    }

    const ONE: (&str, &str) = (
        "0001_people",
        "CREATE TABLE people (id INTEGER PRIMARY KEY);",
    );
    const TWO: (&str, &str) = ("0002_pets", "CREATE TABLE pets (id INTEGER PRIMARY KEY);");

    // Verifies: REQ-DB-002
    #[test]
    fn files_must_be_named_and_numbered_in_order() {
        assert_eq!(checked(&[ONE, TWO]).unwrap()[1].version, 2);
        assert_eq!(checked(&[ONE, TWO]).unwrap()[1].name(), "pets");
        for misnamed in [
            "1_people",
            "0001-people",
            "0001_",
            "0001_People",
            "000a_people",
        ] {
            assert_eq!(
                checked(&[(misnamed, "")]),
                Err(MigrationError::Misnamed(misnamed.into()))
            );
        }
        let gap = checked(&[ONE, ("0003_pets", "")]).unwrap_err();
        assert_eq!(
            gap.to_string(),
            "migration files must be numbered 0001, 0002, … without gaps or duplicates: \
             expected 0002, found 0003_pets.sql"
        );
        let duplicate = checked(&[ONE, ("0001_pets", "")]).unwrap_err();
        assert_eq!(
            duplicate,
            MigrationError::OutOfSequence {
                expected: 2,
                found: "0001_pets".into()
            }
        );
        assert!(embedded().is_ok());
    }

    // Verifies: REQ-DB-002
    #[test]
    fn migrations_apply_in_order_once_and_are_recorded_with_their_checksum() {
        let db = empty();
        let both = checked(&[ONE, TWO]).unwrap();
        assert_eq!(
            status_of(&db, &both),
            Ok(Status {
                applied: 0,
                pending: 2
            })
        );
        assert_eq!(migrate_with(&db, &both[..1]), Ok(1));
        assert_eq!(migrate_with(&db, &both), Ok(1));
        assert_eq!(migrate_with(&db, &both), Ok(0));
        assert_eq!(
            status_of(&db, &both),
            Ok(Status {
                applied: 2,
                pending: 0
            })
        );
        let recorded: String = db
            .read(|c| {
                c.query_row(
                    "SELECT checksum FROM schema_migrations WHERE version = 2",
                    [],
                    |r| r.get(0),
                )
            })
            .unwrap();
        assert_eq!(recorded, both[1].checksum());
        assert_eq!(recorded.len(), 64);
    }

    // Verifies: REQ-DB-002
    #[test]
    fn a_failing_migration_is_rolled_back_whole_and_named() {
        let db = empty();
        let broken = checked(&[
            ONE,
            (
                "0002_half",
                "CREATE TABLE half (id INTEGER); INSERT INTO nowhere VALUES (1);",
            ),
        ])
        .unwrap();
        let error = migrate_with(&db, &broken).unwrap_err();
        assert!(matches!(
            error,
            MigrationError::Failed {
                file: "0002_half",
                ..
            }
        ));
        assert!(!error.to_string().contains("INSERT"), "{error}");
        assert!(!error.to_string().contains("nowhere"), "{error}");
        assert_eq!(status_of(&db, &broken).unwrap().applied, 1);
        let half: i64 = db
            .read(|c| {
                c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name = 'half'",
                    [],
                    |r| r.get(0),
                )
            })
            .unwrap();
        assert_eq!(half, 0, "nothing of the failed migration is kept");
    }

    // Verifies: REQ-DB-002
    #[test]
    fn a_changed_an_unknown_or_a_skipped_migration_stops_start_up() {
        let both = checked(&[ONE, TWO]).unwrap();
        let db = empty();
        migrate_with(&db, &both).unwrap();
        let edited = checked(&[ONE, ("0002_pets", "CREATE TABLE pets (id TEXT);")]).unwrap();
        assert_eq!(
            status_of(&db, &edited),
            Err(MigrationError::Changed("0002_pets".into()))
        );
        assert_eq!(
            migrate_with(&db, &edited),
            Err(MigrationError::Changed("0002_pets".into()))
        );
        let older = &both[..1];
        let newer = status_of(&db, older).unwrap_err();
        assert_eq!(newer, MigrationError::Unknown("0002_pets".into()));
        assert!(newer.to_string().contains("newer than this version"));

        exec(&db, "DELETE FROM schema_migrations WHERE version = 1");
        let gap = status_of(&db, &both).unwrap_err();
        assert_eq!(gap, MigrationError::Gap(1));
        assert!(gap.to_string().contains("skipped migration 0001"));
    }

    // Verifies: REQ-DB-003
    #[test]
    fn checking_changes_nothing() {
        let db = empty();
        assert_eq!(db.migration_status().unwrap().applied, 0);
        let tables: i64 = db
            .read(|c| c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0)))
            .unwrap();
        assert_eq!(tables, 0);
    }

    // Verifies: REQ-DB-008
    #[test]
    fn an_unusable_database_is_a_store_error() {
        let db = empty();
        exec(&db, "CREATE TABLE schema_migrations (other TEXT)");
        assert_eq!(
            db.migration_status(),
            Err(MigrationError::Store(StoreError::Failed))
        );
        assert_eq!(db.migrate().unwrap_err().to_string(), "the database failed");

        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("BEGIN").unwrap();
        assert_eq!(
            apply_next(&mut conn, &[]),
            Err(MigrationError::Store(StoreError::Failed))
        );

        let text = snapshot(&db).unwrap();
        assert!(text.starts_with(SNAPSHOT_HEADER));
    }
}
