// Verifies: REQ-VER-004 REQ-VER-005 REQ-VER-008 REQ-VER-010
//! API compatibility through the UniFFI export surface (same fixture as rust-core).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use serde::Deserialize;
use serde_json::Value;
use tran_uniffi::{
    client_standing, compare_versions, decode_wire_enum, format_client, parse_client,
    update_prompt, TranClientPlatform, TranClientStanding, TranUpdatePromptState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    clients: Vec<ClientCase>,
    formatted: Vec<FormatCase>,
    versions: Vec<VersionCase>,
    standings: Vec<StandingCase>,
    update_prompts: Vec<PromptCase>,
    wire_enums: Vec<Value>,
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
    serde_json::from_str(include_str!("../../../fixtures/compat.json")).unwrap()
}

fn platform_name(platform: TranClientPlatform) -> &'static str {
    match platform {
        TranClientPlatform::Ios => "ios",
        TranClientPlatform::Android => "android",
        TranClientPlatform::Web => "web",
        TranClientPlatform::Unknown => "unknown",
    }
}

fn platform(name: &str) -> TranClientPlatform {
    [
        TranClientPlatform::Ios,
        TranClientPlatform::Android,
        TranClientPlatform::Web,
        TranClientPlatform::Unknown,
    ]
    .into_iter()
    .find(|p| platform_name(*p) == name)
    .unwrap()
}

fn standing_name(standing: TranClientStanding) -> &'static str {
    match standing {
        TranClientStanding::Supported => "supported",
        TranClientStanding::UpdateRecommended => "update_recommended",
        TranClientStanding::UpgradeRequired => "upgrade_required",
    }
}

fn standing(name: &str) -> TranClientStanding {
    [
        TranClientStanding::Supported,
        TranClientStanding::UpdateRecommended,
        TranClientStanding::UpgradeRequired,
    ]
    .into_iter()
    .find(|s| standing_name(*s) == name)
    .unwrap()
}

#[test]
fn clients_parse_and_format_as_the_fixture_says() {
    let f = fixtures();
    for case in f.clients {
        let client = parse_client(case.header);
        assert_eq!(
            platform_name(client.platform),
            case.platform,
            "{}",
            case.name
        );
        assert_eq!(client.version, case.version, "{}", case.name);
    }
    for case in f.formatted {
        assert_eq!(
            format_client(platform(&case.platform), case.version),
            case.header
        );
    }
}

#[test]
fn versions_compare_as_the_fixture_says() {
    for case in fixtures().versions {
        assert_eq!(compare_versions(case.a.clone(), case.b.clone()), case.order);
        assert_eq!(compare_versions(case.b, case.a), -case.order);
    }
}

#[test]
fn standings_and_prompts_match_the_fixture() {
    let f = fixtures();
    for case in f.standings {
        let got = client_standing(parse_client(case.client), case.minimum, case.recommended);
        assert_eq!(standing_name(got), case.standing, "{}", case.name);
    }
    for case in f.update_prompts {
        let show = update_prompt(TranUpdatePromptState {
            standing: standing(&case.standing),
            recommended_version: case.recommended_version,
            dismissed_version: case.dismissed_version,
        });
        assert_eq!(show, case.show, "{}", case.name);
    }
}

#[test]
fn wire_enums_decode_to_their_fallback() {
    let f = fixtures();
    for wire in &f.wire_enums {
        let name = wire["name"].as_str().unwrap().to_string();
        let fallback = wire["fallback"].as_str().unwrap();
        assert_eq!(
            decode_wire_enum(name, "from.the_future".into()).as_deref(),
            Some(fallback)
        );
    }
    for case in f.wire_enum_cases {
        assert_eq!(
            decode_wire_enum(case.name, case.raw).as_deref(),
            Some(case.decoded.as_str())
        );
    }
    assert_eq!(decode_wire_enum("verdict_source".into(), "x".into()), None);
}
