// Verifies: REQ-ROB-004 REQ-ROB-007 REQ-ROB-010
//! Every `server` row of `fixtures/failure-modes.json` against the real router: the envelope, the
//! catalogue status, exactly one `request failed` event at the catalogue level carrying the request
//! id, and no trace of the payload anywhere.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::collections::BTreeMap;

use api::build_app;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, Request};
use http_body_util::BodyExt;
use rust_core::feedback::LOG_EVENT;
use serde::Deserialize;
use serde_json::Value;
use support::Captured;
use tower::ServiceExt;

const FIXTURE: &str = include_str!("../../../fixtures/failure-modes.json");

#[derive(Deserialize)]
struct Fixtures {
    server: Vec<ServerCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerCase {
    id: String,
    name: String,
    request: CaseRequest,
    expect: Expect,
    #[serde(default)]
    must_not_leak: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseRequest {
    method: String,
    path: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    /// Absent: `application/json`. `null`: no header at all.
    #[serde(default = "json_content_type")]
    content_type: Option<String>,
    body: Option<String>,
    /// Generate a well-formed body of this many bytes.
    body_bytes: Option<usize>,
    /// Generate this many nested JSON arrays.
    nesting: Option<usize>,
}

fn json_content_type() -> Option<String> {
    Some("application/json".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expect {
    status: u16,
    code: String,
    log_level: String,
}

impl CaseRequest {
    fn body(&self) -> String {
        if let Some(bytes) = self.body_bytes {
            let skeleton = r#"{"age": 20, "pad": ""}"#;
            let pad = "x".repeat(bytes.saturating_sub(skeleton.len()));
            return format!(r#"{{"age": 20, "pad": "{pad}"}}"#);
        }
        if let Some(depth) = self.nesting {
            return format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        }
        self.body.clone().unwrap_or_default()
    }

    fn build(&self) -> Request<Body> {
        let mut builder = Request::builder()
            .method(self.method.as_str())
            .uri(&self.path);
        if let Some(content_type) = &self.content_type {
            builder = builder.header(header::CONTENT_TYPE, content_type);
        }
        for (name, value) in &self.headers {
            builder = builder.header(name, value);
        }
        builder.body(Body::from(self.body())).unwrap()
    }
}

#[tokio::test]
async fn every_server_failure_mode_is_answered_and_logged_once() {
    let fixtures: Fixtures = serde_json::from_str(FIXTURE).expect("valid fixture");
    for case in fixtures.server {
        let label = format!("{} {}", case.id, case.name);
        let (captured, _guard) = Captured::install();

        let response = build_app(AppState::new())
            .oneshot(case.request.build())
            .await
            .unwrap();
        let status = response.status().as_u16();
        let header_id = response
            .headers()
            .get("x-request-id")
            .map(|v| v.to_str().unwrap().to_string());
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let raw = String::from_utf8_lossy(&bytes).to_string();
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

        // The envelope (REQ-ERR-002) with the catalogue's status and code.
        assert_eq!(status, case.expect.status, "{label}: {raw}");
        assert_eq!(body["success"], false, "{label}: {raw}");
        assert_eq!(body["code"], case.expect.code, "{label}: {raw}");
        assert!(body["error"].is_string(), "{label}: {raw}");
        assert_eq!(body["request_id"].as_str(), header_id.as_deref(), "{label}");

        // Exactly one failure event, at the catalogue level, with the fixed fields (REQ-ROB-007).
        let failures = captured.named(LOG_EVENT.message);
        assert_eq!(failures.len(), 1, "{label}: {failures:?}");
        let event = &failures[0];
        assert_eq!(
            event.level.to_string().to_lowercase(),
            case.expect.log_level,
            "{label}"
        );
        for field in LOG_EVENT.fields {
            assert!(
                event.field(field).is_some(),
                "{label}: no {field} in {event:?}"
            );
        }
        assert_eq!(
            event.field("code"),
            Some(case.expect.code.as_str()),
            "{label}"
        );
        assert_eq!(event.field("request_id"), header_id.as_deref(), "{label}");
        assert_eq!(
            event.field("status"),
            Some(case.expect.status.to_string().as_str()),
            "{label}"
        );

        // No payload in the answer or in any log line.
        for secret in &case.must_not_leak {
            assert!(
                !raw.contains(secret.as_str()),
                "{label}: response leaks {secret}"
            );
            for event in captured.events() {
                assert!(
                    !event.line().contains(secret.as_str()),
                    "{label}: log leaks {secret}: {}",
                    event.line()
                );
            }
        }
    }
}
