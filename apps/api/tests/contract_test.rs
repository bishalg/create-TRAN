// Verifies: REQ-VER-002 REQ-API-011
//! The contract of API version 1, as snapshots of real answers (spec 028, ADR-0030's "the
//! generated files are the snapshots"): every route, its successes and representative errors,
//! normalised and written to `fixtures/contract/v1/`, with the route list and the request schemas.
//! The test fails when regenerating would change a file; `pnpm contract:snapshots` rewrites them
//! after an additive change. `pnpm contract:check` compares them with the last release, and
//! `packages/api/tests/contract-snapshots.test.ts` parses every answer with the clients' schemas.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::print_stderr)]

mod support;

use std::fs;
use std::path::PathBuf;

use api::config::AppConfig;
use api::routes::table::{find, ROUTES};
use api::state::AppState;
use axum::http::{Method, StatusCode};
use rust_core::compat::HEALTH_PATH;
use serde_json::{json, Value};
use support::contract::{normalise, normalise_cookie, run, Call};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/contract/v1")
}

/// The route `call` reaches, as its template (`GET /api/v1/vote/countries/{code}`); a path no
/// route fits is named as it is.
fn route_of(call: &Call) -> String {
    let method = Method::from_bytes(call.method.as_bytes()).unwrap();
    match find(&ROUTES, &method, &call.path) {
        Some(route) => format!("{} {}", call.method, route.template()),
        None => format!("{} {}", call.method, call.path),
    }
}

/// Set to `write` by `pnpm contract:snapshots`.
fn writing() -> bool {
    std::env::var("TRAN_CONTRACT_SNAPSHOTS").as_deref() == Ok("write")
}

/// Compares `value` with the committed file, or writes it.
fn snapshot(name: &str, value: &Value) -> Option<String> {
    let path = root().join(name);
    let rendered = format!("{}\n", serde_json::to_string_pretty(value).unwrap());
    if writing() {
        fs::create_dir_all(root()).unwrap();
        fs::write(&path, rendered).unwrap();
        return None;
    }
    let committed = fs::read_to_string(&path).unwrap_or_default();
    (committed != rendered).then(|| name.to_string())
}

const DEVICE: &str = r#"{"platform": "ios", "push_token": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", "environment": "sandbox", "locale": "ne-NP", "app_version": "1.4.0"}"#;

/// `(case, request)`: every route's success, then representative errors.
fn cases() -> Vec<(&'static str, Value)> {
    let device: Value = serde_json::from_str(DEVICE).unwrap();
    vec![
        ("health", json!({ "method": "GET", "path": HEALTH_PATH })),
        (
            "stack info",
            json!({ "method": "GET", "path": "/api/v1/tran/info" }),
        ),
        (
            "config",
            json!({ "method": "GET", "path": "/api/v1/config" }),
        ),
        (
            "countries",
            json!({ "method": "GET", "path": "/api/v1/vote/countries" }),
        ),
        (
            "one country",
            json!({ "method": "GET", "path": "/api/v1/vote/countries/BR" }),
        ),
        (
            "an unsupported country",
            json!({ "method": "GET", "path": "/api/v1/vote/countries/XX" }),
        ),
        (
            "a malformed country",
            json!({ "method": "GET", "path": "/api/v1/vote/countries/USA" }),
        ),
        (
            "eligible",
            json!({ "method": "POST", "path": "/api/v1/vote/eligibility", "headers": { "x-debug-country": "NP" }, "body": { "age": 20 } }),
        ),
        (
            "eligible by birthdate",
            json!({ "method": "POST", "path": "/api/v1/vote/eligibility", "body": { "age": 0, "birthdate": "2000-01-01" } }),
        ),
        (
            "an age out of range",
            json!({ "method": "POST", "path": "/api/v1/vote/eligibility", "body": { "age": 151 } }),
        ),
        (
            "an unreadable body",
            json!({ "method": "POST", "path": "/api/v1/vote/eligibility", "raw_body": "{\"age\": " }),
        ),
        (
            "sign in, body transport",
            json!({ "method": "POST", "path": "/api/v1/auth/session", "body": { "role": "citizen_voter", "transport": "body" } }),
        ),
        (
            "sign in, cookie transport",
            json!({ "method": "POST", "path": "/api/v1/auth/session", "body": { "role": "election_auditor", "transport": "cookie" } }),
        ),
        (
            "sign in as an unknown role",
            json!({ "method": "POST", "path": "/api/v1/auth/session", "body": { "role": "root", "transport": "body" } }),
        ),
        (
            "who am I",
            json!({ "method": "GET", "path": "/api/v1/auth/session", "auth": "bearer" }),
        ),
        (
            "who am I without a session",
            json!({ "method": "GET", "path": "/api/v1/auth/session" }),
        ),
        (
            "refresh, cookie transport",
            json!({ "method": "POST", "path": "/api/v1/auth/refresh", "auth": "cookie" }),
        ),
        (
            "refresh without a token",
            json!({ "method": "POST", "path": "/api/v1/auth/refresh" }),
        ),
        (
            "sign out",
            json!({ "method": "POST", "path": "/api/v1/auth/sign-out", "auth": "cookie" }),
        ),
        (
            "delete the account",
            json!({ "method": "DELETE", "path": "/api/v1/account", "auth": "bearer" }),
        ),
        (
            "delete the account without a session",
            json!({ "method": "DELETE", "path": "/api/v1/account" }),
        ),
        (
            "register a device",
            json!({ "method": "PUT", "path": "/api/v1/devices/{installation_id}", "auth": "bearer", "body": device }),
        ),
        (
            "register a device with a bad id",
            json!({ "method": "PUT", "path": "/api/v1/devices/not-a-uuid", "auth": "bearer", "body": device }),
        ),
        (
            "unregister a device",
            json!({ "method": "DELETE", "path": "/api/v1/devices/{installation_id}", "auth": "bearer" }),
        ),
        (
            "an unknown route",
            json!({ "method": "GET", "path": "/api/v1/nope" }),
        ),
        (
            "an unknown version",
            json!({ "method": "GET", "path": "/api/v2/tran/info" }),
        ),
        (
            "a method the route does not take",
            json!({ "method": "PATCH", "path": "/api/v1/vote/eligibility" }),
        ),
        (
            "a client below the minimum",
            json!({ "method": "GET", "path": "/api/v1/tran/info", "headers": { "x-tran-client": "web/0.0.1" } }),
        ),
        (
            "a client below the recommended version",
            json!({ "method": "GET", "path": "/api/v1/vote/countries/NP", "headers": { "x-tran-client": "ios/1.0.0" } }),
        ),
    ]
}

/// The thresholds the last two cases meet.
fn state() -> AppState {
    AppState::from_config(&AppConfig::from_lookup(|key| match key {
        "CLIENT_MIN_VERSION_WEB" => Some("0.1.0".into()),
        "CLIENT_RECOMMENDED_VERSION_IOS" => Some("1.1.0".into()),
        _ => None,
    }))
}

/// `(field, type, required)` of each route that takes a body. Proven against the router below, so
/// it cannot claim what the server does not do.
fn request_schemas() -> Value {
    let field = |kind: &str, required: bool| json!({ "type": kind, "required": required });
    json!({
        "POST /api/v1/vote/eligibility": {
            "age": field("number", true),
            "birthdate": field("string", false),
        },
        "POST /api/v1/auth/session": {
            "role": field("string", true),
            "transport": field("string", true),
        },
        "POST /api/v1/auth/refresh": { "refresh_token": field("string", false) },
        "POST /api/v1/auth/sign-out": { "refresh_token": field("string", false) },
        "PUT /api/v1/devices/{installation_id}": {
            "platform": field("string", true),
            "push_token": field("string", true),
            "environment": field("string", true),
            "locale": field("string", true),
            "app_version": field("string", true),
            "marketing": field("boolean", false),
        },
    })
}

/// A valid body for each route in [`request_schemas`].
fn valid_body(route: &str) -> Value {
    match route {
        "POST /api/v1/vote/eligibility" => json!({ "age": 20, "birthdate": "2000-01-01" }),
        "POST /api/v1/auth/session" => json!({ "role": "citizen_voter", "transport": "body" }),
        "PUT /api/v1/devices/{installation_id}" => {
            let mut body: Value = serde_json::from_str(DEVICE).unwrap();
            body["marketing"] = json!(false);
            body
        }
        _ => json!({ "refresh_token": "never-issued" }),
    }
}

/// A value of the wrong type for `kind`.
fn wrong_type(kind: &str) -> Value {
    match kind {
        "string" => json!(7),
        _ => json!("seven"),
    }
}

#[tokio::test]
async fn the_v1_snapshots_match_the_router() {
    let mut answers = Vec::new();
    for (name, request) in cases() {
        let call: Call = serde_json::from_value(request.clone()).unwrap();
        let answer = run(&state(), &call).await;
        let mut entry = json!({
            "case": name,
            "route": route_of(&call),
            "status": answer.status.as_u16(),
            "body": normalise(&answer.json),
        });
        if let Some(cookie) = &answer.set_cookie {
            entry["set_cookie"] = json!(normalise_cookie(cookie));
        }
        if !answer.headers.is_empty() {
            entry["headers"] = json!(answer.headers);
        }
        answers.push(entry);
    }
    let mut routes: Vec<String> = ROUTES
        .iter()
        .map(|r| format!("{} {}", r.verb.as_str(), r.template()))
        .collect();
    routes.insert(0, format!("GET {HEALTH_PATH}"));

    let stale: Vec<String> = [
        snapshot("routes.json", &json!(routes)),
        snapshot("requests.json", &request_schemas()),
        snapshot("responses.json", &Value::Array(answers)),
    ]
    .into_iter()
    .flatten()
    .collect();
    assert!(
        stale.is_empty(),
        "fixtures/contract/v1 is stale ({}): run `pnpm contract:snapshots`, read the diff, and keep it \
         additive (a break needs /api/v2, docs/API_VERSIONING.md)",
        stale.join(", ")
    );
}

#[tokio::test]
async fn every_route_has_a_successful_snapshot() {
    for route in std::iter::once(format!("GET {HEALTH_PATH}")).chain(
        ROUTES
            .iter()
            .map(|r| format!("{} {}", r.verb.as_str(), r.template())),
    ) {
        let mut found = false;
        for (_, request) in cases() {
            let call: Call = serde_json::from_value(request).unwrap();
            if route_of(&call) == route {
                found |= run(&state(), &call).await.status.is_success();
            }
        }
        assert!(found, "{route} has no successful case");
    }
}

/// The request schemas say what the server does: a missing required field or a wrong type is
/// `400`, a missing optional field is not.
#[tokio::test]
async fn the_request_schemas_match_what_the_server_accepts() {
    let schemas = request_schemas();
    for (route, fields) in schemas.as_object().unwrap() {
        let (method, path) = route.split_once(' ').unwrap();
        let auth = path.contains("/devices/").then_some("bearer");
        let send = |body: Value| {
            let call: Call = serde_json::from_value(json!({
                "method": method, "path": path, "auth": auth, "body": body
            }))
            .unwrap();
            async move { run(&state(), &call).await.status }
        };
        assert_ne!(
            send(valid_body(route)).await,
            StatusCode::BAD_REQUEST,
            "{route}: the valid body"
        );
        for (name, spec) in fields.as_object().unwrap() {
            let mut without = valid_body(route);
            without.as_object_mut().unwrap().remove(name);
            let status = send(without).await;
            let required = spec["required"].as_bool().unwrap();
            assert_eq!(
                status == StatusCode::BAD_REQUEST,
                required,
                "{route}: without {name} answered {status}"
            );
            if required {
                let mut retyped = valid_body(route);
                retyped[name] = wrong_type(spec["type"].as_str().unwrap());
                assert_eq!(
                    send(retyped).await,
                    StatusCode::BAD_REQUEST,
                    "{route}: {name} of the wrong type"
                );
            }
        }
    }
    if writing() {
        eprintln!("contract: wrote fixtures/contract/v1");
    }
}
