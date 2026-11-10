// Verifies: REQ-SEC-006 REQ-SEC-007 REQ-SEC-008 REQ-SEC-009 REQ-SEC-010 REQ-SEC-011 REQ-SEC-012
//! The session endpoints against the real router and an in-memory store on a manual clock.
//! Naming follows the spec's "Verified by" lines: `cookie_transport_*`, `body_transport_*`,
//! `bearer_*`, `refresh_*`, `sign_out_*`, `foreign_origin_*`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::session_store::InMemorySessionStore;
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const LOCAL_ORIGIN: &str = "http://localhost:3000";
const FOREIGN_ORIGIN: &str = "https://evil.example";

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    json: Value,
}

impl Reply {
    fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    /// The token in `Set-Cookie: tran_refresh=<token>; …`, `Some("")` for a clearing cookie.
    fn cookie_token(&self) -> Option<&str> {
        let cookie = self.header(header::SET_COOKIE)?;
        Some(
            cookie
                .strip_prefix("tran_refresh=")?
                .split(';')
                .next()
                .unwrap(),
        )
    }

    fn str(&self, field: &str) -> &str {
        self.json[field].as_str().unwrap_or_default()
    }
}

/// One API instance: shared in-memory sessions on a clock the test moves.
struct Api {
    state: AppState,
    clock: Arc<ManualClock>,
}

impl Api {
    fn new() -> Self {
        Self::with_config(AppConfig::from_lookup(|_| None))
    }

    fn with_config(config: AppConfig) -> Self {
        let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let clock = Arc::new(ManualClock::starting_at(start));
        let state = AppState {
            sessions: Sessions::new(Arc::new(InMemorySessionStore::default()), clock.clone()),
            ..AppState::from_config(&config)
        };
        Self { state, clock }
    }

    fn in_production() -> Self {
        Self::with_config(AppConfig::from_lookup(|key| {
            (key == "APP_ENV").then(|| "production".to_string())
        }))
    }

    async fn send(&self, request: Request<Body>) -> Reply {
        let response = build_app(self.state.clone())
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        Reply {
            status,
            headers,
            json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        }
    }

    async fn sign_in(&self, role: &str, transport: &str) -> Reply {
        let body = json!({ "role": role, "transport": transport }).to_string();
        self.send(post("/api/auth/session", &body, &[])).await
    }

    async fn whoami(&self, authorization: Option<&str>) -> Reply {
        let mut builder = Request::builder().uri("/api/auth/session");
        if let Some(value) = authorization {
            builder = builder.header(header::AUTHORIZATION, value);
        }
        self.send(builder.body(Body::empty()).unwrap()).await
    }

    async fn refresh_by_body(&self, token: &str) -> Reply {
        let body = json!({ "refresh_token": token }).to_string();
        self.send(post("/api/auth/refresh", &body, &[])).await
    }

    async fn refresh_by_cookie(&self, token: &str) -> Reply {
        let cookie = format!("theme=dark; tran_refresh={token}");
        self.send(post("/api/auth/refresh", "", &[("cookie", &cookie)]))
            .await
    }
}

fn post(uri: &str, body: &str, headers: &[(&str, &str)]) -> Request<Body> {
    let mut builder = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    builder.body(Body::from(body.to_string())).unwrap()
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

fn assert_session_expired(reply: &Reply, label: &str) {
    assert_eq!(
        reply.status,
        StatusCode::UNAUTHORIZED,
        "{label}: {}",
        reply.json
    );
    assert_eq!(reply.json["code"], "auth.session_expired", "{label}");
    assert_eq!(reply.json["success"], false, "{label}");
}

fn assert_cleared(reply: &Reply) {
    let cookie = reply.header(header::SET_COOKIE).expect("Set-Cookie");
    assert_eq!(
        cookie,
        "tran_refresh=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0"
    );
}

fn assert_opaque(token: &str) {
    let bytes = URL_SAFE_NO_PAD.decode(token).expect("unpadded base64url");
    assert_eq!(bytes.len(), rust_core::session::SESSION_POLICY.token_bytes);
}

// ── Sign-in (REQ-SEC-006) ───────────────────────────────────────────────────

#[tokio::test]
async fn sign_in_issues_an_opaque_pair_with_the_policy_lifetime() {
    let api = Api::new();
    let reply = api.sign_in("citizen_voter", "body").await;

    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
    assert_eq!(reply.json["token_type"], "Bearer");
    assert_eq!(reply.json["expires_in"], 900);
    assert_eq!(
        reply.json["user"],
        json!({ "user_id": "voter-001", "role": "citizen_voter" })
    );
    assert_opaque(reply.str("access_token"));
    assert_opaque(reply.str("refresh_token"));
    assert_ne!(reply.str("access_token"), reply.str("refresh_token"));

    let auditor = api.sign_in("election_auditor", "body").await;
    assert_eq!(
        auditor.json["user"],
        json!({ "user_id": "auditor-001", "role": "election_auditor" })
    );
    assert_ne!(auditor.str("access_token"), reply.str("access_token"));
}

#[tokio::test]
async fn sign_in_rejects_an_unknown_role_or_transport_with_the_envelope() {
    let api = Api::new();
    for body in [
        r#"{"role": "admin", "transport": "body"}"#,
        r#"{"role": "citizen_voter", "transport": "url"}"#,
        r#"{"role": "citizen_voter"}"#,
        "",
    ] {
        let reply = api.send(post("/api/auth/session", body, &[])).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(reply.json["code"], "request.malformed", "{body}");
        assert!(reply.header(header::SET_COOKIE).is_none(), "{body}");
    }
}

// ── Transports (REQ-SEC-007) ────────────────────────────────────────────────

#[tokio::test]
async fn cookie_transport_sends_the_refresh_token_only_as_an_http_only_cookie() {
    let reply = Api::new().sign_in("citizen_voter", "cookie").await;

    assert_eq!(reply.status, StatusCode::CREATED);
    let token = reply.cookie_token().expect("refresh cookie");
    assert_opaque(token);
    assert_eq!(
        reply.header(header::SET_COOKIE).unwrap(),
        format!("tran_refresh={token}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=2592000")
    );
    assert!(reply.json.get("refresh_token").is_none(), "{}", reply.json);
    assert!(!reply.json.to_string().contains(token));
}

#[tokio::test]
async fn cookie_transport_is_secure_outside_development_and_test() {
    let api = Api::in_production();
    let reply = api.sign_in("citizen_voter", "cookie").await;
    assert!(reply
        .header(header::SET_COOKIE)
        .unwrap()
        .ends_with("; Max-Age=2592000; Secure"));

    let cleared = api.refresh_by_cookie("unknown").await;
    assert!(cleared
        .header(header::SET_COOKIE)
        .unwrap()
        .ends_with("; Max-Age=0; Secure"));
}

#[tokio::test]
async fn cookie_transport_refresh_is_answered_by_cookie() {
    let api = Api::new();
    let first = api.sign_in("citizen_voter", "cookie").await;
    let reply = api.refresh_by_cookie(first.cookie_token().unwrap()).await;

    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    let rotated = reply.cookie_token().expect("a new refresh cookie");
    assert_opaque(rotated);
    assert_ne!(rotated, first.cookie_token().unwrap());
    assert!(reply.json.get("refresh_token").is_none());
    assert_eq!(reply.json["user"]["user_id"], "voter-001");
}

#[tokio::test]
async fn body_transport_sends_the_refresh_token_in_the_body_and_no_cookie() {
    let api = Api::new();
    let first = api.sign_in("election_auditor", "body").await;
    assert!(first.header(header::SET_COOKIE).is_none());

    let reply = api.refresh_by_body(first.str("refresh_token")).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
    assert!(reply.header(header::SET_COOKIE).is_none());
    assert_opaque(reply.str("refresh_token"));
    assert_ne!(reply.str("refresh_token"), first.str("refresh_token"));
    assert_eq!(reply.json["token_type"], "Bearer");
    assert_eq!(reply.json["user"]["role"], "election_auditor");
}

// ── Bearer authentication (REQ-SEC-008) ─────────────────────────────────────

#[tokio::test]
async fn bearer_access_token_returns_the_session_user() {
    let api = Api::new();
    let signed_in = api.sign_in("election_auditor", "body").await;
    let token = signed_in.str("access_token");

    for authorization in [bearer(token), format!("bearer  {token}")] {
        let reply = api.whoami(Some(&authorization)).await;
        assert_eq!(reply.status, StatusCode::OK, "{authorization}");
        assert_eq!(
            reply.json,
            json!({ "user_id": "auditor-001", "role": "election_auditor" })
        );
    }
}

#[tokio::test]
async fn bearer_gives_one_answer_to_every_bad_token() {
    let api = Api::new();
    let signed_in = api.sign_in("citizen_voter", "body").await;
    let access = signed_in.str("access_token").to_string();
    let revoked = api.sign_in("citizen_voter", "body").await;
    let body = json!({ "refresh_token": revoked.str("refresh_token") }).to_string();
    api.send(post("/api/auth/sign-out", &body, &[])).await;

    let cases: Vec<(&str, Option<String>)> = vec![
        ("missing header", None),
        ("another scheme", Some(format!("Basic {access}"))),
        ("scheme only", Some("Bearer".to_string())),
        ("malformed", Some(bearer("!!not base64!!"))),
        ("unknown", Some(bearer(&URL_SAFE_NO_PAD.encode([7u8; 32])))),
        (
            "refresh token as access",
            Some(bearer(signed_in.str("refresh_token"))),
        ),
        ("revoked", Some(bearer(revoked.str("access_token")))),
    ];
    let mut bodies = Vec::new();
    for (label, authorization) in cases {
        let reply = api.whoami(authorization.as_deref()).await;
        assert_session_expired(&reply, label);
        assert_eq!(
            reply.header(header::WWW_AUTHENTICATE),
            Some("Bearer"),
            "{label}"
        );
        let mut json = reply.json.clone();
        json["request_id"] = Value::Null;
        bodies.push(json);
    }
    assert!(
        bodies.windows(2).all(|pair| pair[0] == pair[1]),
        "{bodies:?}"
    );

    let mut request = Request::builder().uri("/api/auth/session");
    request = request.header(
        header::AUTHORIZATION,
        HeaderValue::from_bytes(b"Bearer \xff\xfe").unwrap(),
    );
    let reply = api.send(request.body(Body::empty()).unwrap()).await;
    assert_session_expired(&reply, "not ASCII");
}

#[tokio::test]
async fn bearer_expiry_is_measured_on_the_injected_clock() {
    let api = Api::new();
    let signed_in = api.sign_in("citizen_voter", "body").await;
    let authorization = bearer(signed_in.str("access_token"));

    api.clock.advance(Duration::seconds(899));
    assert_eq!(
        api.whoami(Some(&authorization)).await.status,
        StatusCode::OK
    );
    api.clock.advance(Duration::seconds(1));
    assert_session_expired(&api.whoami(Some(&authorization)).await, "expired");
}

// ── Refresh (REQ-SEC-009) ───────────────────────────────────────────────────

#[tokio::test]
async fn refresh_rotates_the_pair_and_spends_the_old_refresh_token() {
    let api = Api::new();
    let first = api.sign_in("citizen_voter", "body").await;

    api.clock.advance(Duration::seconds(1_000));
    let second = api.refresh_by_body(first.str("refresh_token")).await;
    assert_eq!(second.status, StatusCode::OK);
    assert_eq!(second.json["expires_in"], 900);
    let whoami = api.whoami(Some(&bearer(second.str("access_token")))).await;
    assert_eq!(whoami.status, StatusCode::OK);
    assert_session_expired(
        &api.whoami(Some(&bearer(first.str("access_token")))).await,
        "the first access token has expired",
    );

    let third = api.refresh_by_body(second.str("refresh_token")).await;
    assert_eq!(third.status, StatusCode::OK);
}

#[tokio::test]
async fn refresh_without_a_token_answers_401_and_clears_the_cookie() {
    let api = Api::new();
    for (label, body, headers) in [
        ("no body", "", vec![]),
        ("empty object", "{}", vec![]),
        ("not JSON", "{\"refresh_token\": ", vec![]),
        ("empty cookie", "", vec![("cookie", "tran_refresh=")]),
        (
            "other cookies only",
            "",
            vec![("cookie", "theme=dark; tran_refreshx=1")],
        ),
    ] {
        let reply = api.send(post("/api/auth/refresh", body, &headers)).await;
        assert_session_expired(&reply, label);
        assert_cleared(&reply);
    }
}

#[tokio::test]
async fn refresh_with_an_unknown_token_answers_401_on_its_transport() {
    let api = Api::new();
    let by_body = api.refresh_by_body("unknown").await;
    assert_session_expired(&by_body, "body");
    assert!(by_body.header(header::SET_COOKIE).is_none());

    let by_cookie = api.refresh_by_cookie("unknown").await;
    assert_session_expired(&by_cookie, "cookie");
    assert_cleared(&by_cookie);
}

#[tokio::test]
async fn refresh_with_an_expired_token_answers_401() {
    let api = Api::new();
    let first = api.sign_in("citizen_voter", "cookie").await;
    api.clock.advance(Duration::seconds(2_592_000));
    let reply = api.refresh_by_cookie(first.cookie_token().unwrap()).await;
    assert_session_expired(&reply, "expired refresh");
    assert_cleared(&reply);
}

// ── Replay (REQ-SEC-010) ────────────────────────────────────────────────────

#[tokio::test]
async fn replayed_refresh_token_revokes_the_family() {
    let api = Api::new();
    let first = api.sign_in("citizen_voter", "body").await;
    let second = api.refresh_by_body(first.str("refresh_token")).await;
    assert_eq!(second.status, StatusCode::OK);

    let replay = api.refresh_by_body(first.str("refresh_token")).await;
    assert_session_expired(&replay, "replay");

    for (label, token) in [
        ("first access", first.str("access_token")),
        ("second access", second.str("access_token")),
    ] {
        assert_session_expired(&api.whoami(Some(&bearer(token))).await, label);
    }
    assert_session_expired(
        &api.refresh_by_body(second.str("refresh_token")).await,
        "second refresh",
    );

    let other = api.sign_in("citizen_voter", "body").await;
    let whoami = api.whoami(Some(&bearer(other.str("access_token")))).await;
    assert_eq!(
        whoami.status,
        StatusCode::OK,
        "other sessions are untouched"
    );
}

// ── Sign-out (REQ-SEC-011) ──────────────────────────────────────────────────

#[tokio::test]
async fn sign_out_by_cookie_revokes_the_session_and_clears_the_cookie() {
    let api = Api::new();
    let signed_in = api.sign_in("citizen_voter", "cookie").await;
    let cookie = format!("tran_refresh={}", signed_in.cookie_token().unwrap());

    let reply = api
        .send(post("/api/auth/sign-out", "", &[("cookie", &cookie)]))
        .await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert_cleared(&reply);
    assert_session_expired(
        &api.whoami(Some(&bearer(signed_in.str("access_token"))))
            .await,
        "access after sign-out",
    );
    assert_session_expired(
        &api.refresh_by_cookie(signed_in.cookie_token().unwrap())
            .await,
        "refresh after sign-out",
    );
}

#[tokio::test]
async fn sign_out_by_body_revokes_the_session_without_a_cookie() {
    let api = Api::new();
    let signed_in = api.sign_in("election_auditor", "body").await;
    let body = json!({ "refresh_token": signed_in.str("refresh_token") }).to_string();

    let reply = api.send(post("/api/auth/sign-out", &body, &[])).await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert!(reply.header(header::SET_COOKIE).is_none());
    assert_session_expired(
        &api.whoami(Some(&bearer(signed_in.str("access_token"))))
            .await,
        "access after sign-out",
    );
}

#[tokio::test]
async fn sign_out_answers_204_for_a_missing_or_unknown_token_and_can_repeat() {
    let api = Api::new();
    for body in [
        "",
        r#"{"refresh_token": "unknown"}"#,
        r#"{"refresh_token": "unknown"}"#,
    ] {
        let reply = api.send(post("/api/auth/sign-out", body, &[])).await;
        assert_eq!(reply.status, StatusCode::NO_CONTENT, "{body}");
    }
}

// ── Origin check (REQ-SEC-012) ──────────────────────────────────────────────

#[tokio::test]
async fn foreign_origin_is_refused_on_every_auth_endpoint() {
    let api = Api::new();
    let origin = [("origin", FOREIGN_ORIGIN)];
    for (uri, body) in [
        (
            "/api/auth/session",
            r#"{"role": "citizen_voter", "transport": "cookie"}"#,
        ),
        ("/api/auth/refresh", ""),
        ("/api/auth/sign-out", ""),
    ] {
        let reply = api.send(post(uri, body, &origin)).await;
        assert_eq!(reply.status, StatusCode::FORBIDDEN, "{uri}");
        assert_eq!(reply.json["code"], "auth.forbidden", "{uri}");
        assert!(reply.header(header::SET_COOKIE).is_none(), "{uri}");
        assert!(reply.header(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        assert!(!reply.json.to_string().contains(FOREIGN_ORIGIN));
    }
}

#[tokio::test]
async fn foreign_origin_changes_nothing() {
    let api = Api::new();
    let signed_in = api.sign_in("citizen_voter", "cookie").await;
    let cookie = format!("tran_refresh={}", signed_in.cookie_token().unwrap());

    let refused = api
        .send(post(
            "/api/auth/sign-out",
            "",
            &[("cookie", &cookie), ("origin", FOREIGN_ORIGIN)],
        ))
        .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    let still = api
        .refresh_by_cookie(signed_in.cookie_token().unwrap())
        .await;
    assert_eq!(still.status, StatusCode::OK, "the session survived");
}

#[tokio::test]
async fn foreign_origin_check_spares_allowed_origins_and_other_routes() {
    let api = Api::new();
    let body = r#"{"role": "citizen_voter", "transport": "cookie"}"#;
    let reply = api
        .send(post("/api/auth/session", body, &[("origin", LOCAL_ORIGIN)]))
        .await;
    assert_eq!(reply.status, StatusCode::CREATED);
    assert_eq!(
        reply.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(LOCAL_ORIGIN)
    );
    assert_eq!(
        reply.header(header::ACCESS_CONTROL_ALLOW_CREDENTIALS),
        Some("true")
    );

    let health = Request::builder()
        .uri("/api/health")
        .header(header::ORIGIN, FOREIGN_ORIGIN)
        .body(Body::empty())
        .unwrap();
    assert_eq!(api.send(health).await.status, StatusCode::OK);
}
