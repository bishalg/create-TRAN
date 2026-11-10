//! Shared by the contract snapshots and the client replay (spec 028): one way to describe a
//! request, run it against the real router (signing in first when it needs a session), and
//! normalise the answer so a snapshot only changes when the contract does.

use std::collections::BTreeMap;

use api::build_app;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tower::ServiceExt;

/// The installation id every `{installation_id}` stands for.
pub const INSTALLATION_ID: &str = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c";

/// The session a request needs before it is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Auth {
    /// Sign in with the body transport and send `Authorization: Bearer <access token>`.
    Bearer,
    /// Sign in with the cookie transport and send the refresh cookie, as a browser does.
    Cookie,
    /// Sign in with the body transport and put the refresh token where the body says
    /// `{refresh_token}`, as a native app refreshes or signs out.
    RefreshToken,
}

/// One request, as a fixture spells it.
#[derive(Debug, Clone, Deserialize)]
pub struct Call {
    pub method: String,
    /// The path, with `{installation_id}` for the device registry.
    pub path: String,
    #[serde(default)]
    pub auth: Option<Auth>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// A JSON body; `null` or absent sends none.
    #[serde(default)]
    pub body: Value,
    /// A body sent as it is (not JSON), for unreadable-body cases.
    #[serde(default)]
    pub raw_body: Option<String>,
}

/// What came back.
pub struct Answer {
    pub status: StatusCode,
    pub set_cookie: Option<String>,
    /// The compatibility headers a client acts on, when present.
    pub headers: BTreeMap<String, String>,
    pub json: Value,
}

/// The response headers a snapshot keeps: the ones an app acts on (REQ-VER-006, REQ-VER-007).
pub const HEADERS_OF_INTEREST: [&str; 4] = [
    "x-tran-update",
    "x-tran-recommended-version",
    "deprecation",
    "sunset",
];

async fn oneshot(state: &AppState, request: Request<Body>) -> Answer {
    let response = build_app(state.clone()).oneshot(request).await.unwrap();
    let status = response.status();
    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_string());
    let headers = HEADERS_OF_INTEREST
        .iter()
        .filter_map(|name| {
            let value = response.headers().get(*name)?;
            Some((name.to_string(), value.to_str().unwrap().to_string()))
        })
        .collect();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Answer {
        status,
        set_cookie,
        headers,
        json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

/// Signs in as a voter with `transport`; returns the access token, the cookie header value and
/// the refresh token when the body carried it.
async fn sign_in(state: &AppState, transport: &str) -> (String, Option<String>, Option<String>) {
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/auth/session")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "role": "citizen_voter", "transport": transport }).to_string(),
        ))
        .unwrap();
    let answer = oneshot(state, request).await;
    assert_eq!(answer.status, StatusCode::CREATED, "setup sign-in");
    let cookie = answer
        .set_cookie
        .map(|c| c.split(';').next().unwrap().to_string());
    (
        answer.json["access_token"].as_str().unwrap().to_string(),
        cookie,
        answer.json["refresh_token"].as_str().map(str::to_string),
    )
}

/// Runs `call` against a router over `state`, signing in first when the call needs a session.
pub async fn run(state: &AppState, call: &Call) -> Answer {
    let mut builder = Request::builder()
        .method(Method::from_bytes(call.method.as_bytes()).unwrap())
        .uri(call.path.replace("{installation_id}", INSTALLATION_ID));
    let mut refresh_token = None;
    match call.auth {
        Some(Auth::Bearer) => {
            let (access, _, _) = sign_in(state, "body").await;
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {access}"));
        }
        Some(Auth::Cookie) => {
            let (_, cookie, _) = sign_in(state, "cookie").await;
            builder = builder.header(header::COOKIE, cookie.unwrap());
        }
        Some(Auth::RefreshToken) => refresh_token = sign_in(state, "body").await.2,
        None => {}
    }
    for (name, value) in &call.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    let text = match (&call.raw_body, &call.body) {
        (Some(raw), _) => Some(raw.clone()),
        (None, Value::Null) => None,
        (None, json) => Some(json.to_string()),
    }
    .map(|text| match &refresh_token {
        Some(token) => text.replace("{refresh_token}", token),
        None => text,
    });
    let body = match text {
        Some(text) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(text)
        }
        None => Body::empty(),
    };
    oneshot(state, builder.body(body).unwrap()).await
}

fn is_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok() && value.len() == 36
}

fn is_timestamp(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

/// Stable stand-ins for what changes on every run, chosen to still parse with the clients'
/// schemas: a fixed v4 UUID and the epoch.
pub const UUID: &str = "00000000-0000-4000-8000-000000000000";
pub const TIMESTAMP: &str = "1970-01-01T00:00:00Z";

/// `value` with every id, time, token, request id, version and uptime replaced, recursively.
pub fn normalise(value: &Value) -> Value {
    fn walk(key: Option<&str>, value: &Value) -> Value {
        match (key, value) {
            (Some("access_token" | "refresh_token"), Value::String(_)) => json!("<token>"),
            (Some("request_id"), Value::String(_)) => json!("<request-id>"),
            (Some("version"), Value::String(_)) => json!("<version>"),
            (Some("uptime_seconds"), Value::Number(_)) => json!(0),
            (_, Value::String(s)) if is_uuid(s) => json!(UUID),
            (_, Value::String(s)) if is_timestamp(s) => json!(TIMESTAMP),
            (_, Value::Object(map)) => Value::Object(
                map.iter()
                    .map(|(k, v)| (k.clone(), walk(Some(k), v)))
                    .collect::<Map<_, _>>(),
            ),
            (_, Value::Array(items)) => Value::Array(items.iter().map(|v| walk(None, v)).collect()),
            (_, other) => other.clone(),
        }
    }
    walk(None, value)
}

/// A `Set-Cookie` value with its token replaced.
pub fn normalise_cookie(cookie: &str) -> String {
    match cookie.split_once('=') {
        Some((name, rest)) => {
            let attributes = rest.split_once(';').map(|(_, a)| a).unwrap_or_default();
            let value = if rest.starts_with(';') { "" } else { "<token>" };
            format!("{name}={value};{attributes}")
        }
        None => cookie.to_string(),
    }
}

/// The JSON type name of `value`, as the replay fixtures spell it.
pub fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// The values at a dotted path: `user.role`, or `components[].name` for every item of an array.
pub fn at<'a>(value: &'a Value, path: &str) -> Vec<&'a Value> {
    let mut found = vec![value];
    for part in path.split('.') {
        let (name, each) = match part.strip_suffix("[]") {
            Some(name) => (name, true),
            None => (part, false),
        };
        found = found
            .into_iter()
            .filter_map(|v| v.get(name))
            .flat_map(|v| match (each, v) {
                (true, Value::Array(items)) => items.iter().collect::<Vec<_>>(),
                (true, _) => Vec::new(),
                (false, v) => vec![v],
            })
            .collect();
    }
    found
}
