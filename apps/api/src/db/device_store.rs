//! [`DeviceStore`] on SQL (REQ-DB-001, REQ-DB-006, REQ-DB-007, spec 027).
//!
//! Table `device_registrations` (`apps/api/schema.sql`). Its unique `push_token` is what leaves
//! one registration per token however many arrive at once; [`DeviceStore::register`] removes the
//! token's other holders and writes this one in one transaction, and only while the session it
//! names is live, so a registration never outlives its session (REQ-PSH-003).

use chrono::{DateTime, Utc};
use rusqlite::Row;

use super::{decode, instant, micros, rows, Database};
use crate::devices::{
    DevicePlatform, DeviceStore, InstallationId, PushEnvironment, PushToken, Registration,
};
use crate::session_store::{SessionId, StoreError};

const PLATFORMS: &[(&str, DevicePlatform)] = &[
    ("ios", DevicePlatform::Ios),
    ("android", DevicePlatform::Android),
];

const ENVIRONMENTS: &[(&str, PushEnvironment)] = &[
    ("sandbox", PushEnvironment::Sandbox),
    ("production", PushEnvironment::Production),
];

const COLUMNS: &str = "installation_id, user_id, session_id, platform, environment, push_token, \
                       locale, app_version, marketing, refreshed_at";

/// The device registry on `db`.
#[derive(Debug, Clone)]
pub struct SqlDeviceStore {
    db: Database,
}

impl SqlDeviceStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }
}

/// The columns of a row of [`COLUMNS`], as stored.
type Columns = (
    String,
    String,
    i64,
    String,
    String,
    String,
    String,
    String,
    bool,
    i64,
);

/// A registration from a row of [`COLUMNS`]; a value the API would never write is a broken row.
fn registration_from(row: &Row<'_>) -> rusqlite::Result<Registration> {
    let (
        installation,
        user_id,
        session,
        platform,
        environment,
        token,
        locale,
        app_version,
        marketing,
        refreshed_at,
    ): Columns = row.try_into()?;
    let platform = decode(&platform, PLATFORMS)?;
    Ok(Registration {
        installation: InstallationId::parse(&installation).ok_or(rusqlite::Error::InvalidQuery)?,
        user_id,
        session: SessionId(session),
        platform,
        environment: decode(&environment, ENVIRONMENTS)?,
        token: PushToken::parse(platform, &token).ok_or(rusqlite::Error::InvalidQuery)?,
        locale,
        app_version,
        marketing,
        refreshed_at: instant(refreshed_at)?,
    })
}

impl DeviceStore for SqlDeviceStore {
    fn register(&self, registration: Registration) -> Result<usize, StoreError> {
        let installation = registration.installation.stored();
        let live = "EXISTS (SELECT 1 FROM sessions WHERE id = ?3 AND user_id = ?2)";
        self.db.write(|transaction| {
            transaction
                .execute(
                    &format!(
                        "DELETE FROM device_registrations \
                     WHERE push_token = ?1 AND installation_id <> ?4 AND {live}"
                    ),
                    (
                        registration.token.expose(),
                        &registration.user_id,
                        registration.session.0,
                        &installation,
                    ),
                )
                .and_then(|displaced| {
                    transaction
                        .execute(
                            &format!(
                                "INSERT INTO device_registrations ({COLUMNS}) \
                     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE {live} \
                     ON CONFLICT (installation_id) DO UPDATE SET \
                     user_id = excluded.user_id, session_id = excluded.session_id, \
                     platform = excluded.platform, environment = excluded.environment, \
                     push_token = excluded.push_token, locale = excluded.locale, \
                     app_version = excluded.app_version, marketing = excluded.marketing, \
                     refreshed_at = excluded.refreshed_at"
                            ),
                            (
                                &installation,
                                &registration.user_id,
                                registration.session.0,
                                registration.platform.as_str(),
                                registration.environment.as_str(),
                                registration.token.expose(),
                                &registration.locale,
                                &registration.app_version,
                                registration.marketing,
                                micros(registration.refreshed_at),
                            ),
                        )
                        .map(|_| displaced)
                })
        })
    }

    fn unregister(&self, user_id: &str, installation: &InstallationId) -> Result<bool, StoreError> {
        self.db.write(|transaction| {
            transaction
                .execute(
                    "DELETE FROM device_registrations WHERE installation_id = ?1 AND user_id = ?2",
                    (installation.stored(), user_id),
                )
                .map(|removed| removed == 1)
        })
    }

    fn remove_if_token(
        &self,
        installation: &InstallationId,
        token: &PushToken,
    ) -> Result<bool, StoreError> {
        self.db.write(|transaction| {
            transaction
                .execute(
                    "DELETE FROM device_registrations \
                     WHERE installation_id = ?1 AND push_token = ?2",
                    (installation.stored(), token.expose()),
                )
                .map(|removed| removed == 1)
        })
    }

    fn for_user(&self, user_id: &str) -> Result<Vec<Registration>, StoreError> {
        self.db.read(|connection| {
            rows(
                connection,
                &format!(
                    "SELECT {COLUMNS} FROM device_registrations WHERE user_id = ?1 \
                     ORDER BY installation_id"
                ),
                [user_id],
                registration_from,
            )
        })
    }

    fn prune(&self, cutoff: DateTime<Utc>) -> Result<usize, StoreError> {
        self.db.write(|transaction| {
            transaction.execute(
                "DELETE FROM device_registrations WHERE refreshed_at <= ?1",
                [micros(cutoff)],
            )
        })
    }
}

#[cfg(test)]
#[path = "device_store_tests.rs"]
mod tests;
