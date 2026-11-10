//! The API's database (spec 030, ADR-0049): SQLite through `rusqlite`, one connection per process.
//!
//! [`Database`] owns the connection and its settings ([`DB_POLICY`]). The SQL stores
//! ([`SqlSessionStore`], [`SqlDeviceStore`]) are the only stores: tests run them on
//! [`Database::in_memory`], so nothing passes on a store production never uses (REQ-DB-001).
//!
//! Store calls are synchronous, so a transaction is a straight line of code. They never run on the
//! async executor: request code reaches them through [`off_runtime`] (tokio's blocking pool), via
//! [`crate::sessions::Sessions::blocking`] (REQ-DB-008). One connection behind a mutex is the single
//! writer inside a process; between processes SQLite's own lock decides, and every write
//! transaction takes it up front (`BEGIN IMMEDIATE`) and waits at most
//! [`DbPolicy::busy_timeout_ms`] for it.

pub mod device_store;
pub mod migrate;
pub mod prune;
pub mod session_store;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, ErrorCode, Transaction, TransactionBehavior};
use rust_core::feedback::SERVER_DEADLINE_MS;

use crate::error::ApiError;
use crate::secret::Secret;

pub use device_store::SqlDeviceStore;
pub use session_store::SqlSessionStore;

/// How the database is used: numbers with a test, not literals in code (REQ-DB-008).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DbPolicy {
    /// The longest a statement waits for another connection's lock before the store answers
    /// [`StoreError::Busy`]. Below the request deadline, so a locked database answers `503` from the
    /// store, not from the deadline.
    pub busy_timeout_ms: u64,
    /// How often the server deletes expired rows ([`prune`]).
    pub prune_interval_seconds: u64,
}

/// The sample's settings. One connection per process: SQLite has one writer, so a pool would only
/// move the queue from this mutex into SQLite's lock.
pub const DB_POLICY: DbPolicy = DbPolicy {
    busy_timeout_ms: 2_000,
    prune_interval_seconds: 60 * 60,
};

const _: () = assert!(DB_POLICY.busy_timeout_ms < SERVER_DEADLINE_MS);

impl DbPolicy {
    pub fn busy_timeout(&self) -> Duration {
        Duration::from_millis(self.busy_timeout_ms)
    }

    pub fn prune_interval(&self) -> Duration {
        Duration::from_secs(self.prune_interval_seconds)
    }
}

/// Where the database file is when `DATABASE_URL` is unset, relative to the working directory (the
/// repository root under `pnpm dev:api`).
pub const DEFAULT_DATABASE_PATH: &str = "data/api.sqlite3";

/// What `DATABASE_URL` names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Location {
    /// `sqlite::memory:`: gone when the process ends (tests, e2e).
    Memory,
    /// `sqlite:<path>` or `sqlite://<path>`, or [`DEFAULT_DATABASE_PATH`] when unset.
    File(PathBuf),
}

impl Location {
    /// Reads `DATABASE_URL`. The error never repeats the value: it may carry a password.
    pub fn parse(url: Option<&Secret>) -> Result<Self, String> {
        let Some(url) = url else {
            return Ok(Self::File(PathBuf::from(DEFAULT_DATABASE_PATH)));
        };
        let rest = url.expose().strip_prefix("sqlite:");
        match rest.map(|rest| rest.strip_prefix("//").unwrap_or(rest)) {
            Some(":memory:") => Ok(Self::Memory),
            Some(path) if !path.is_empty() => Ok(Self::File(PathBuf::from(path))),
            _ => {
                Err("DATABASE_URL must be sqlite:<path> or sqlite::memory: (spec 030)".to_string())
            }
        }
    }
}

/// Why a store call failed. Neither variant carries SQL, a value or SQLite's own message, so
/// nothing a store says can leak a query into a response or a log (REQ-DB-008).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    /// Another connection held the lock for longer than [`DbPolicy::busy_timeout_ms`].
    #[error("the database is busy")]
    Busy,
    /// Anything else: an unreadable file, a missing table, a broken row.
    #[error("the database failed")]
    Failed,
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        match error.sqlite_error_code() {
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => Self::Busy,
            _ => Self::Failed,
        }
    }
}

/// A store failure answers `503 server.unavailable`, retryable, with a fixed message.
impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        ApiError::Rejected {
            code: rust_core::feedback::ErrorCode::ServerUnavailable,
            message: format!("{error}; try again shortly"),
        }
    }
}

/// Runs `work` on tokio's blocking pool, so a store call never stalls the request runtime
/// (REQ-DB-008). A panic inside it answers [`StoreError::Failed`].
pub async fn off_runtime<T, E>(work: impl FnOnce() -> Result<T, E> + Send + 'static) -> Result<T, E>
where
    T: Send + 'static,
    E: From<StoreError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .unwrap_or_else(|_| Err(StoreError::Failed.into()))
}

/// A database connection with the settings of [`DB_POLICY`]. Cloning shares the connection.
#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Database")
    }
}

impl Database {
    /// Opens `location` without migrating it. A file database runs with write-ahead logging, and
    /// every database enforces foreign keys. The parent directory of a file is created.
    pub fn open(location: &Location, policy: &DbPolicy) -> Result<Self, StoreError> {
        let opened = match location {
            Location::Memory => Connection::open_in_memory(),
            Location::File(path) => open_file(path),
        };
        let file = matches!(location, Location::File(_));
        opened
            .and_then(|connection| configure(connection, file, policy))
            .map(|connection| Self {
                connection: Arc::new(Mutex::new(connection)),
            })
            .map_err(StoreError::from)
    }

    /// A fresh, migrated in-memory database: what every test and [`crate::state::AppState::new`]
    /// run on.
    pub fn in_memory() -> Self {
        #[allow(
            clippy::expect_used,
            reason = "an in-memory database opens unless memory is exhausted, and the embedded \
                      migrations apply to an empty one (migrations_test proves it)"
        )]
        let database = Self::open(&Location::Memory, &DB_POLICY).expect("memory is available");
        #[allow(clippy::expect_used, reason = "as above")]
        database
            .migrate()
            .expect("the embedded migrations apply to an empty database");
        database
    }

    /// Runs `work` on the connection, without a transaction: for reads.
    pub(crate) fn read<T>(
        &self,
        work: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, StoreError> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        work(&connection).map_err(StoreError::from)
    }

    /// Runs `work` in one transaction that holds the write lock from its first statement
    /// (`BEGIN IMMEDIATE`), and commits it; an error rolls everything back (REQ-DB-006).
    pub(crate) fn write<T>(
        &self,
        work: impl FnOnce(&Transaction<'_>) -> rusqlite::Result<T>,
    ) -> Result<T, StoreError> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .and_then(|transaction| {
                work(&transaction).and_then(|value| transaction.commit().map(|()| value))
            })
            .map_err(StoreError::from)
    }

    /// Runs `work` with the connection itself, for the migration runner's own transactions.
    pub(crate) fn with_connection<T>(&self, work: impl FnOnce(&mut Connection) -> T) -> T {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        work(&mut connection)
    }
}

/// Bounded lock waits and foreign keys everywhere; write-ahead logging for a file (REQ-DB-008).
fn configure(
    connection: Connection,
    file: bool,
    policy: &DbPolicy,
) -> rusqlite::Result<Connection> {
    connection
        .busy_timeout(policy.busy_timeout())
        .and_then(|()| connection.pragma_update(None, "foreign_keys", true))
        .and_then(|()| {
            if file {
                connection
                    .pragma_update(None, "journal_mode", "WAL")
                    .and_then(|()| connection.pragma_update(None, "synchronous", "NORMAL"))
            } else {
                Ok(())
            }
        })
        .map(|()| connection)
}

/// Every row `sql` answers, mapped by `map`.
pub(crate) fn rows<T>(
    connection: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Vec<T>> {
    connection.prepare(sql).and_then(|mut statement| {
        let all = statement
            .query_map(params, map)
            .and_then(|mapped| mapped.collect());
        all
    })
}

fn open_file(path: &Path) -> rusqlite::Result<Connection> {
    // A folder that cannot be made shows as the open failing just below.
    let _ = path.parent().map(std::fs::create_dir_all);
    Connection::open(path)
}

/// An instant as stored: Unix microseconds, UTC.
pub(crate) fn micros(at: DateTime<Utc>) -> i64 {
    at.timestamp_micros()
}

/// A stored instant read back; out of range is a broken row.
pub(crate) fn instant(micros: i64) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::from_timestamp_micros(micros)
        .ok_or(rusqlite::Error::IntegralValueOutOfRange(0, micros))
}

/// One of `options` by its stored name; anything else is a broken row.
pub(crate) fn decode<T: Copy>(stored: &str, options: &[(&str, T)]) -> rusqlite::Result<T> {
    options
        .iter()
        .find(|(name, _)| *name == stored)
        .map(|(_, value)| *value)
        .ok_or(rusqlite::Error::InvalidQuery)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::devices::{
        DevicePlatform, InstallationId, PushEnvironment, PushToken, Registration,
    };
    use crate::session_store::{PairDigests, SessionId, SessionUser, StoredSession, Transport};
    use rust_core::UserRole;

    pub(crate) fn t(seconds: i64) -> DateTime<Utc> {
        DateTime::<Utc>::UNIX_EPOCH + chrono::Duration::seconds(seconds)
    }

    /// Pair `n`: access digest `[n; 32]` until 900 s, refresh digest `[n + 100; 32]` until 2 000 s.
    pub(crate) fn pair(n: u8) -> PairDigests {
        PairDigests {
            access: [n; 32],
            access_expires_at: t(900),
            refresh: [n + 100; 32],
            refresh_expires_at: t(2_000),
        }
    }

    pub(crate) fn user(user_id: &str, transport: Transport) -> StoredSession {
        StoredSession {
            user: SessionUser {
                user_id: user_id.into(),
                role: UserRole::CitizenVoter,
            },
            transport,
        }
    }

    /// Installation `n` (1–9) of `user_id`, made in session `session`, holding token `token`.
    pub(crate) fn registration(
        n: u8,
        user_id: &str,
        session: SessionId,
        token: char,
    ) -> Registration {
        Registration {
            installation: InstallationId::parse(&format!("2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6{n}"))
                .unwrap(),
            user_id: user_id.into(),
            session,
            platform: DevicePlatform::Ios,
            environment: PushEnvironment::Production,
            token: PushToken::parse(DevicePlatform::Ios, &token.to_string().repeat(64)).unwrap(),
            locale: "en".into(),
            app_version: "1.0.0".into(),
            marketing: false,
            refreshed_at: t(0),
        }
    }

    /// Runs `sql` on the database's own connection: a test's way to break or inspect it.
    pub(crate) fn exec(db: &Database, sql: &str) {
        db.with_connection(|c| c.execute_batch(sql)).unwrap();
    }

    pub(crate) fn count(db: &Database, table: &str) -> i64 {
        db.read(|c| c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)))
            .unwrap()
    }

    // Verifies: REQ-DB-008
    #[test]
    fn the_policy_bounds_every_wait_below_the_request_deadline() {
        assert_eq!(DB_POLICY.busy_timeout(), Duration::from_secs(2));
        assert_eq!(DB_POLICY.prune_interval(), Duration::from_secs(3_600));
    }

    // Verifies: REQ-DB-001
    #[test]
    fn database_url_names_a_file_or_memory_and_is_never_echoed() {
        let parse = |raw: &str| Location::parse(Some(&Secret::new(raw)));
        assert_eq!(
            Location::parse(None),
            Ok(Location::File(PathBuf::from("data/api.sqlite3")))
        );
        assert_eq!(parse("sqlite::memory:"), Ok(Location::Memory));
        assert_eq!(parse("sqlite://:memory:"), Ok(Location::Memory));
        assert_eq!(
            parse("sqlite:/srv/api.db"),
            Ok(Location::File("/srv/api.db".into()))
        );
        assert_eq!(
            parse("sqlite://var/api.db"),
            Ok(Location::File("var/api.db".into()))
        );
        for wrong in [
            "postgres://u:SENTINEL@h/db",
            "sqlite:",
            "sqlite://",
            "api.db",
        ] {
            let error = parse(wrong).unwrap_err();
            assert!(
                error.contains("DATABASE_URL") && !error.contains("SENTINEL"),
                "{error}"
            );
        }
    }

    // Verifies: REQ-DB-008
    #[test]
    fn store_errors_say_busy_or_failed_and_nothing_else() {
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            Some("SELECT secret FROM t".into()),
        );
        assert_eq!(StoreError::from(busy), StoreError::Busy);
        let locked = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_LOCKED),
            None,
        );
        assert_eq!(StoreError::from(locked), StoreError::Busy);
        assert_eq!(
            StoreError::from(rusqlite::Error::InvalidQuery),
            StoreError::Failed
        );
        let failure = ApiError::from(StoreError::Busy).failure();
        assert_eq!(failure.code.as_str(), "server.unavailable");
        assert_eq!(failure.message, "the database is busy; try again shortly");
    }

    // Verifies: REQ-DB-008
    #[tokio::test]
    async fn work_off_the_runtime_returns_its_value_and_a_panic_is_a_failure() {
        let value: Result<u8, StoreError> = off_runtime(|| Ok(7)).await;
        assert_eq!(value, Ok(7));
        let panicked: Result<u8, StoreError> = off_runtime(|| panic!("in a store")).await;
        assert_eq!(panicked, Err(StoreError::Failed));
    }

    // Verifies: REQ-DB-008
    #[test]
    fn a_file_database_logs_ahead_and_every_database_enforces_foreign_keys() {
        let dir = std::env::temp_dir().join(format!("tran-db-unit-{}", uuid::Uuid::new_v4()));
        let file =
            Database::open(&Location::File(dir.join("nested/api.sqlite3")), &DB_POLICY).unwrap();
        let pragma = |db: &Database, name: &str| -> String {
            db.read(|c| {
                c.query_row(&format!("PRAGMA {name}"), [], |r| {
                    r.get::<_, rusqlite::types::Value>(0)
                })
            })
            .map(|value| format!("{value:?}"))
            .unwrap()
        };
        assert_eq!(pragma(&file, "journal_mode"), "Text(\"wal\")");
        assert_eq!(pragma(&file, "foreign_keys"), "Integer(1)");
        assert_eq!(pragma(&file, "busy_timeout"), "Integer(2000)");
        let memory = Database::in_memory();
        assert_eq!(pragma(&memory, "foreign_keys"), "Integer(1)");
        let orphan = memory.write(|tx| {
            tx.execute(
                "INSERT INTO access_tokens VALUES (zeroblob(32), 404, 0)",
                [],
            )
        });
        assert_eq!(orphan, Err(StoreError::Failed), "a token needs its session");
        drop(file);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stored_values_decode_or_fail() {
        assert_eq!(decode("b", &[("a", 1), ("b", 2)]), Ok(2));
        assert!(decode("c", &[("a", 1)]).is_err());
        let at = DateTime::<Utc>::from_timestamp(1_800_000_000, 5_000).unwrap();
        assert_eq!(instant(micros(at)), Ok(at));
        assert!(instant(i64::MAX).is_err());
        assert_eq!(format!("{:?}", Database::in_memory()), "Database");
    }
}
