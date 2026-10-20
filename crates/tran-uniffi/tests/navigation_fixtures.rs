// Verifies: REQ-NAV-006 REQ-RULE-009
//! Navigation and the country table through the UniFFI export surface (same fixtures as rust-core).

use serde::Deserialize;
use tran_uniffi::{
    resolve_destination_offline, supported_countries_offline, TranAppDestination, TranUserRole,
};

#[derive(Deserialize)]
struct NavigationFixtures {
    destinations: Vec<DestinationCase>,
}

#[derive(Deserialize)]
struct DestinationCase {
    name: String,
    session: String,
    destination: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleFixtures {
    countries: Vec<CountryCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CountryCase {
    country_code: String,
    minimum_age: u16,
}

fn role(session: &str) -> Option<TranUserRole> {
    match session {
        "none" | "unauthenticated" => None,
        "citizen_voter" => Some(TranUserRole::CitizenVoter),
        "election_auditor" => Some(TranUserRole::ElectionAuditor),
        other => panic!("unknown fixture session {other:?}"),
    }
}

fn name(destination: TranAppDestination) -> &'static str {
    match destination {
        TranAppDestination::Splash => "splash",
        TranAppDestination::AuthWelcome => "auth_welcome",
        TranAppDestination::VoterDashboard => "voter_dashboard",
        TranAppDestination::AuditorDashboard => "auditor_dashboard",
    }
}

#[test]
fn destinations_match_fixture() {
    let fixtures: NavigationFixtures =
        serde_json::from_str(include_str!("../../../fixtures/navigation.json")).unwrap();
    for case in fixtures.destinations {
        let destination = resolve_destination_offline(role(&case.session));
        assert_eq!(name(destination), case.destination, "{}", case.name);
    }
}

#[test]
fn supported_countries_match_fixture() {
    let fixtures: RuleFixtures =
        serde_json::from_str(include_str!("../../../fixtures/vote-eligibility.json")).unwrap();
    let actual: Vec<(String, u16)> = supported_countries_offline()
        .into_iter()
        .map(|c| (c.country_code, c.minimum_age))
        .collect();
    let expected: Vec<(String, u16)> = fixtures
        .countries
        .into_iter()
        .map(|c| (c.country_code, c.minimum_age))
        .collect();
    assert_eq!(actual, expected);
}
