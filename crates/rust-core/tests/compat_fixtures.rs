// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-005 REQ-VER-008 REQ-VER-010
//! `fixtures/compat.json` against `rust_core::compat`; the same file pins TypeScript, UniFFI and
//! the native apps.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::cmp::Ordering;

use rust_core::compat::{
    client_standing, compare_versions, format_client, parse_client, update_prompt, wire_enum,
    ClientPlatform, ClientStanding, UpdatePromptState, API_BASE_PATH, CLIENT_HEADER, HEALTH_PATH,
    RECOMMENDED_VERSION_HEADER, UPDATE_HEADER, UPDATE_RECOMMENDED, WIRE_ENUMS,
};
use serde::Deserialize;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../../../fixtures/compat.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    base_path: String,
    health_path: String,
    headers: Value,
    clients: Vec<ClientCase>,
    formatted: Vec<FormatCase>,
    versions: Vec<VersionCase>,
    standings: Vec<StandingCase>,
    update_prompts: Vec<PromptCase>,
    wire_enums: Value,
    wire_enum_cases: Vec<WireCase>,
}

#[derive(Deserialize)]
struct ClientCase {
    name: String,
    header: Option<String>,
    platform: String,
    version: Option<String>,
}

#[derive(Deserialize)]
struct FormatCase {
    platform: String,
    version: String,
    header: String,
}

#[derive(Deserialize)]
struct VersionCase {
    a: String,
    b: String,
    order: i8,
}

#[derive(Deserialize)]
struct StandingCase {
    name: String,
    client: Option<String>,
    minimum: Option<String>,
    recommended: Option<String>,
    standing: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptCase {
    name: String,
    standing: String,
    recommended_version: Option<String>,
    dismissed_version: Option<String>,
    show: bool,
}

#[derive(Deserialize)]
struct WireCase {
    #[serde(rename = "enum")]
    name: String,
    raw: String,
    decoded: String,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/compat.json")
}

fn platform(name: &str) -> ClientPlatform {
    ClientPlatform::ALL
        .into_iter()
        .find(|p| p.as_str() == name)
        .unwrap_or_else(|| panic!("unknown fixture platform {name:?}"))
}

fn standing(name: &str) -> ClientStanding {
    ClientStanding::ALL
        .into_iter()
        .find(|s| s.as_str() == name)
        .unwrap_or_else(|| panic!("unknown fixture standing {name:?}"))
}

#[test]
fn paths_and_headers_match_the_fixture() {
    let f = fixtures();
    assert_eq!(API_BASE_PATH, f.base_path);
    assert_eq!(HEALTH_PATH, f.health_path);
    assert_eq!(
        json!({
            "client": CLIENT_HEADER,
            "update": UPDATE_HEADER,
            "updateRecommended": UPDATE_RECOMMENDED,
            "recommendedVersion": RECOMMENDED_VERSION_HEADER,
        }),
        f.headers
    );
}

#[test]
fn client_headers_parse_as_the_fixture_says() {
    for case in fixtures().clients {
        let client = parse_client(case.header.as_deref());
        assert_eq!(client.platform.as_str(), case.platform, "{}", case.name);
        assert_eq!(client.version, case.version, "{}", case.name);
    }
}

#[test]
fn client_headers_format_and_round_trip() {
    for case in fixtures().formatted {
        let header = format_client(platform(&case.platform), &case.version);
        assert_eq!(header, case.header);
        let parsed = parse_client(Some(&header));
        assert_eq!(parsed.platform.as_str(), case.platform);
        assert_eq!(parsed.version.as_deref(), Some(case.version.as_str()));
    }
}

#[test]
fn versions_compare_as_the_fixture_says() {
    for case in fixtures().versions {
        let expected = case.order.cmp(&0);
        assert_eq!(
            compare_versions(&case.a, &case.b),
            expected,
            "{} vs {}",
            case.a,
            case.b
        );
        assert_eq!(
            compare_versions(&case.b, &case.a),
            expected.reverse(),
            "{} vs {}",
            case.b,
            case.a
        );
    }
    assert_eq!(compare_versions("", "0"), Ordering::Equal);
}

#[test]
fn standings_match_the_fixture() {
    for case in fixtures().standings {
        let client = parse_client(case.client.as_deref());
        let got = client_standing(
            &client,
            case.minimum.as_deref(),
            case.recommended.as_deref(),
        );
        assert_eq!(got.as_str(), case.standing, "{}", case.name);
    }
}

#[test]
fn update_prompts_match_the_fixture() {
    for case in fixtures().update_prompts {
        let show = update_prompt(UpdatePromptState {
            standing: standing(&case.standing),
            recommended_version: case.recommended_version.as_deref(),
            dismissed_version: case.dismissed_version.as_deref(),
        });
        assert_eq!(show, case.show, "{}", case.name);
    }
}

#[test]
fn wire_enums_and_their_fallbacks_match_the_fixture() {
    let f = fixtures();
    let actual: Vec<Value> = WIRE_ENUMS
        .iter()
        .map(|w| json!({ "name": w.name, "field": w.field, "values": w.values, "fallback": w.fallback }))
        .collect();
    assert_eq!(Value::Array(actual), f.wire_enums);
    for case in f.wire_enum_cases {
        let wire = wire_enum(&case.name).expect("a declared wire enum");
        assert_eq!(
            wire.decode(&case.raw),
            case.decoded,
            "{} {:?}",
            case.name,
            case.raw
        );
    }
}
