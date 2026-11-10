//! A file database in its own temporary folder, removed when dropped: for the tests that need
//! two connections, a second process's lock or a database broken from outside (spec 030).
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use api::config::AppConfig;
use api::db::{Database, DbPolicy, Location, DB_POLICY};
use api::secret::Secret;

pub struct TempDb {
    dir: PathBuf,
}

impl TempDb {
    pub fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("tran-db-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }

    pub fn path(&self) -> PathBuf {
        self.dir.join("api.sqlite3")
    }

    pub fn location(&self) -> Location {
        Location::File(self.path())
    }

    /// `DATABASE_URL` for this file.
    pub fn url(&self) -> String {
        format!("sqlite:{}", self.path().display())
    }

    /// A new connection with `policy`, not migrated.
    pub fn open_with(&self, policy: &DbPolicy) -> Database {
        Database::open(&self.location(), policy).unwrap()
    }

    /// A new connection with the sample's policy, migrated.
    pub fn open(&self) -> Database {
        let db = self.open_with(&DB_POLICY);
        db.migrate().unwrap();
        db
    }

    /// A raw connection, as another process or an operator has it.
    pub fn raw(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.path()).unwrap()
    }

    /// Configuration naming this file, plus `pairs`.
    pub fn config(&self, pairs: &[(&str, &str)]) -> AppConfig {
        let url = self.url();
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        AppConfig::from_lookup(move |key| {
            if key == "DATABASE_URL" {
                return Some(url.clone());
            }
            pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
        })
    }

    pub fn secret_url(&self) -> Secret {
        Secret::new(self.url())
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
