//! What deleting an account erases (REQ-ACC-001 to REQ-ACC-003, ADR-0041).
//!
//! `DELETE /api/account` calls one [`AccountEraser`]. The sample's accounts own nothing but their
//! sessions, so [`SessionsOnly`] revokes those and is done. A fork replaces it with an eraser that
//! removes every table, file and third-party record of the user, then the sessions, in one
//! transaction or one job, and answers `Err` if any of it fails: the route then changes nothing
//! the client can see and the device keeps its session (REQ-ACC-006).

use crate::error::ApiError;
use crate::session_store::SessionUser;
use crate::sessions::Sessions;

pub trait AccountEraser: Send + Sync {
    /// Erases everything the server holds for `user`, ending with every session of the user on
    /// every device ([`Sessions::revoke_user`]).
    fn erase(&self, user: &SessionUser, sessions: &Sessions) -> Result<(), ApiError>;
}

/// The sample's eraser: a demo account holds nothing but its sessions.
#[derive(Debug, Default, Clone, Copy)]
pub struct SessionsOnly;

impl AccountEraser for SessionsOnly {
    fn erase(&self, user: &SessionUser, sessions: &Sessions) -> Result<(), ApiError> {
        sessions.revoke_user(&user.user_id);
        Ok(())
    }
}
