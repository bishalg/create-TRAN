// Verifies: REQ-NAV-006
//! Golden navigation cases from `fixtures/navigation.json`, shared with TypeScript, UniFFI and native.

use rust_core::{resolve_destination, AppDestination, AuthSession, UserRole};
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/navigation.json");

#[derive(Deserialize)]
struct Fixtures {
    destinations: Vec<DestinationCase>,
}

#[derive(Deserialize)]
struct DestinationCase {
    name: String,
    session: String,
    destination: String,
}

fn session(raw: &str) -> Option<AuthSession> {
    let authenticated = |role| {
        Some(AuthSession::Authenticated {
            user_id: "fixture-user".to_string(),
            role,
        })
    };
    match raw {
        "none" => None,
        "unauthenticated" => Some(AuthSession::Unauthenticated),
        "citizen_voter" => authenticated(UserRole::CitizenVoter),
        "election_auditor" => authenticated(UserRole::ElectionAuditor),
        other => panic!("unknown fixture session {other:?}"),
    }
}

#[test]
fn destinations_match_fixture() {
    let fixtures: Fixtures = serde_json::from_str(FIXTURE).expect("fixtures/navigation.json");
    for case in fixtures.destinations {
        let destination = resolve_destination(session(&case.session).as_ref());
        assert_eq!(destination.as_str(), case.destination, "{}", case.name);
    }
}

#[test]
fn every_destination_has_a_snake_case_name() {
    let names: Vec<&str> = [
        AppDestination::Splash,
        AppDestination::AuthWelcome,
        AppDestination::VoterDashboard,
        AppDestination::AuditorDashboard,
    ]
    .iter()
    .map(AppDestination::as_str)
    .collect();
    assert_eq!(
        names,
        [
            "splash",
            "auth_welcome",
            "voter_dashboard",
            "auditor_dashboard"
        ]
    );
}
