//! Central Navigation Director and role-based branching models.
//!
//! Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserRole {
    CitizenVoter,
    ElectionAuditor,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CitizenVoter => "citizen_voter",
            Self::ElectionAuditor => "election_auditor",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthSession {
    Unauthenticated,
    Authenticated { user_id: String, role: UserRole },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AppDestination {
    Splash,
    AuthWelcome,
    VoterDashboard,
    AuditorDashboard,
}

/// Central Navigation Director resolving the target destination from stored session state.
pub fn resolve_destination(session: Option<&AuthSession>) -> AppDestination {
    match session {
        None | Some(AuthSession::Unauthenticated) => AppDestination::AuthWelcome,
        Some(AuthSession::Authenticated {
            role: UserRole::CitizenVoter,
            ..
        }) => AppDestination::VoterDashboard,
        Some(AuthSession::Authenticated {
            role: UserRole::ElectionAuditor,
            ..
        }) => AppDestination::AuditorDashboard,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unauthenticated_resolves_to_auth_welcome() {
        // Verifies: REQ-NAV-001, REQ-NAV-002
        assert_eq!(resolve_destination(None), AppDestination::AuthWelcome);
        assert_eq!(
            resolve_destination(Some(&AuthSession::Unauthenticated)),
            AppDestination::AuthWelcome
        );
    }

    #[test]
    fn test_citizen_voter_resolves_to_voter_dashboard() {
        // Verifies: REQ-NAV-003
        let session = AuthSession::Authenticated {
            user_id: "voter-001".to_string(),
            role: UserRole::CitizenVoter,
        };
        assert_eq!(
            resolve_destination(Some(&session)),
            AppDestination::VoterDashboard
        );
        assert_eq!(UserRole::CitizenVoter.as_str(), "citizen_voter");
    }

    #[test]
    fn test_election_auditor_resolves_to_auditor_dashboard() {
        // Verifies: REQ-NAV-004
        let session = AuthSession::Authenticated {
            user_id: "auditor-001".to_string(),
            role: UserRole::ElectionAuditor,
        };
        assert_eq!(
            resolve_destination(Some(&session)),
            AppDestination::AuditorDashboard
        );
        assert_eq!(UserRole::ElectionAuditor.as_str(), "election_auditor");
    }

    #[test]
    fn test_sign_out_transitions_back_to_auth_welcome() {
        // Verifies: REQ-NAV-005
        let mut session = AuthSession::Authenticated {
            user_id: "voter-001".to_string(),
            role: UserRole::CitizenVoter,
        };
        assert_eq!(
            resolve_destination(Some(&session)),
            AppDestination::VoterDashboard
        );

        // Clear session on sign out
        session = AuthSession::Unauthenticated;
        assert_eq!(
            resolve_destination(Some(&session)),
            AppDestination::AuthWelcome
        );
    }
}
