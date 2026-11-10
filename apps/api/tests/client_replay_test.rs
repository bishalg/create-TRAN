// Verifies: REQ-VER-003 REQ-VER-007
//! Released clients are replayed against today's server (spec 028, ADR-0047 decision 2). Every
//! file in `fixtures/contract/clients/<platform>/` holds the requests one client version makes and
//! the response fields it reads: `current.json` the client in this tree, `<version>.json` each
//! release `pnpm release` recorded. Each request must still answer the status that client expects,
//! with every field it reads present and of the same type. A route a kept client calls cannot be
//! removed: its replay answers `404`. A version leaves the replay only when it is below its
//! platform's minimum (its file is deleted then).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use api::state::AppState;
use serde::Deserialize;
use support::contract::{at, run, type_name, Call};

fn clients_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/contract/clients")
}

/// The version `pnpm release` owns, for the `{version}` of `current.json`.
fn tree_version() -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../package.json");
    let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(root).unwrap()).unwrap();
    json["version"].as_str().unwrap().to_string()
}

#[derive(Deserialize)]
struct ClientFile {
    platform: String,
    version: String,
    requests: Vec<Replayed>,
}

#[derive(Deserialize)]
struct Replayed {
    name: String,
    #[serde(flatten)]
    call: Call,
    status: u16,
    reads: BTreeMap<String, String>,
}

fn client_files() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(clients_dir())
        .unwrap()
        .map(|platform| platform.unwrap().path())
        .filter(|path| path.is_dir())
        .flat_map(|dir| fs::read_dir(dir).unwrap().map(|f| f.unwrap().path()))
        .filter(|path| path.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    files
}

fn load(path: &Path) -> ClientFile {
    let text = fs::read_to_string(path)
        .unwrap()
        .replace("{version}", &tree_version());
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn every_platform_folder_is_named_for_a_platform_and_holds_its_current_client() {
    let files = client_files();
    assert!(!files.is_empty());
    for path in &files {
        let platform = path
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert!(
            ["ios", "android", "web"].contains(&platform),
            "{}",
            path.display()
        );
        let file = load(path);
        assert_eq!(file.platform, platform, "{}", path.display());
        let stem = path.file_stem().unwrap().to_str().unwrap();
        if stem != "current" {
            assert_eq!(file.version, stem, "{}", path.display());
        }
        for request in &file.requests {
            let header = request.call.headers.get("X-Tran-Client");
            assert_eq!(
                header.map(String::as_str),
                Some(format!("{platform}/{}", file.version).as_str()),
                "{} › {}: every request names its client",
                path.display(),
                request.name
            );
        }
    }
    assert!(files.iter().any(|f| f.ends_with("web/current.json")));
}

#[tokio::test]
async fn every_kept_client_is_still_served_as_it_was_built_to_read() {
    let mut failures = Vec::new();
    for path in client_files() {
        let file = load(&path);
        let stem = path.file_stem().unwrap().to_str().unwrap();
        let client = format!("{}/{stem}", file.platform);
        for request in &file.requests {
            let answer = run(&AppState::new(), &request.call).await;
            let what = format!(
                "{client} › {} ({} {})",
                request.name, request.call.method, request.call.path
            );
            if answer.status.as_u16() != request.status {
                let hint = if answer.status.as_u16() == 404 {
                    ": a route this client calls was removed; raise the minimum and delete its file first"
                } else {
                    ""
                };
                failures.push(format!(
                    "{what}: status {} instead of {}{hint}",
                    answer.status, request.status
                ));
                continue;
            }
            for (field, expected) in &request.reads {
                let values = at(&answer.json, field);
                let types: Vec<&str> = values.iter().map(|v| type_name(v)).collect();
                if values.is_empty() || types.iter().any(|t| t != expected) {
                    failures.push(format!(
                        "{what}: {field} should be {expected}, got {types:?}"
                    ));
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "replay failed:\n  {}",
        failures.join("\n  ")
    );
}

/// What a native client's manifest needs: the refresh token in the body (`auth: refresh_token`).
#[tokio::test]
async fn a_native_refresh_and_sign_out_replay_with_the_body_transport() {
    for (path, status) in [
        ("/api/v1/auth/refresh", 200),
        ("/api/v1/auth/sign-out", 204),
    ] {
        let call: Call = serde_json::from_value(serde_json::json!({
            "method": "POST",
            "path": path,
            "auth": "refresh_token",
            "body": { "refresh_token": "{refresh_token}" },
        }))
        .unwrap();
        assert_eq!(
            run(&AppState::new(), &call).await.status.as_u16(),
            status,
            "{path}"
        );
    }
}
