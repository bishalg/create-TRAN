//! A local stand-in for APNs, Google's token endpoint and FCM, and throwaway keys, so the real
//! senders are tested with no network and no credential (ADR-0046). Shared by
//! `push_senders_test.rs` and `push_providers_test.rs`.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::collections::{BTreeMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::task::{Context, Poll};
use std::time::Duration;

use api::clock::ManualClock;
use api::push::apns::{ApnsCredentials, ApnsEndpoints, ApnsSender};
use api::push::fcm::{FcmEndpoints, FcmSender, ServiceAccount};
use api::push::jwt::{Es256Key, Rs256Key};
use api::push::sender::ProviderAnswer;
use api::push::transport::{HttpClient, Protocol};
use aws_lc_rs::encoding::AsDer;
use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::rsa::{KeyPair as RsaKeyPair, KeySize};
use aws_lc_rs::signature::{
    EcdsaKeyPair, KeyPair, UnparsedPublicKey, ECDSA_P256_SHA256_FIXED,
    ECDSA_P256_SHA256_FIXED_SIGNING, RSA_PKCS1_2048_8192_SHA256,
};
use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{StatusCode, Version};
use axum::response::Response;
use axum::Router;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use hyper::body::Frame;
use serde_json::{json, Value};

pub const KEY_ID: &str = "ABC123DEFG";
pub const TEAM_ID: &str = "DEF123GHIJ";
pub const PROJECT: &str = "tran-sample";
pub const CLIENT_EMAIL: &str = "push-sender@tran-sample.iam.gserviceaccount.com";
pub const PRIVATE_KEY_ID: &str = "0123456789abcdef0123456789abcdef01234567";
/// What the fake token endpoint grants, so a test can look for it in logs.
pub const ACCESS_TOKEN: &str = "ya29.SENTINEL-access-token";
pub const TOKEN_PATH: &str = "/token";

/// Unix second 1 800 000 000: where every manual clock here starts.
pub fn start() -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap()
}

// ── Throwaway keys ──────────────────────────────────────────────────────────

fn pem(der: &[u8]) -> String {
    let body = STANDARD.encode(der);
    let lines: Vec<&str> = body
        .as_bytes()
        .chunks(64)
        .map(|chunk| std::str::from_utf8(chunk).unwrap())
        .collect();
    // Spelled in parts so the secret scan does not take this builder for a key.
    let (begin, end) = (
        concat!("-----BEGIN ", "PRIVATE KEY-----"),
        concat!("-----END ", "PRIVATE KEY-----"),
    );
    format!("{begin}\n{}\n{end}\n", lines.join("\n"))
}

/// A P-256 key made for this test run, as a `.p8` would hold it, and its public point.
pub struct ApnsKey {
    pub pem: String,
    pub public: Vec<u8>,
}

pub fn apns_key() -> &'static ApnsKey {
    static KEY: OnceLock<ApnsKey> = OnceLock::new();
    KEY.get_or_init(|| {
        let der =
            EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
                .unwrap();
        let pair =
            EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, der.as_ref()).unwrap();
        ApnsKey {
            pem: pem(der.as_ref()),
            public: pair.public_key().as_ref().to_vec(),
        }
    })
}

/// An RSA key made for this test run, as a service account's `private_key` holds it.
pub struct GoogleKey {
    pub pem: String,
    pub public: Vec<u8>,
}

pub fn google_key() -> &'static GoogleKey {
    static KEY: OnceLock<GoogleKey> = OnceLock::new();
    KEY.get_or_init(|| {
        let pair = RsaKeyPair::generate(KeySize::Rsa2048).unwrap();
        let der = AsDer::<aws_lc_rs::encoding::Pkcs8V1Der>::as_der(&pair).unwrap();
        GoogleKey {
            pem: pem(der.as_ref()),
            public: pair.public_key().as_ref().to_vec(),
        }
    })
}

/// A service account's JSON key around the throwaway RSA key.
pub fn service_account_json() -> String {
    json!({
        "type": "service_account",
        "project_id": PROJECT,
        "private_key_id": PRIVATE_KEY_ID,
        "private_key": google_key().pem,
        "client_email": CLIENT_EMAIL,
        "token_uri": "https://oauth2.googleapis.com/token",
    })
    .to_string()
}

/// A JWT's header and claims, after its signature verified with `verify`.
pub struct Jwt {
    pub header: Value,
    pub claims: Value,
}

fn decode_jwt(jwt: &str, verify: impl Fn(&[u8], &[u8]) -> bool) -> Jwt {
    let parts: Vec<&str> = jwt.split('.').collect();
    assert_eq!(parts.len(), 3, "a compact JWS has three parts");
    let part = |i: usize| -> Value {
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[i]).unwrap()).unwrap()
    };
    let signature = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
    let input = format!("{}.{}", parts[0], parts[1]);
    assert!(verify(input.as_bytes(), &signature), "signature verifies");
    Jwt {
        header: part(0),
        claims: part(1),
    }
}

pub fn verify_es256(jwt: &str) -> Jwt {
    decode_jwt(jwt, |input, signature| {
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, &apns_key().public)
            .verify(input, signature)
            .is_ok()
    })
}

pub fn verify_rs256(jwt: &str) -> Jwt {
    decode_jwt(jwt, |input, signature| {
        UnparsedPublicKey::new(&RSA_PKCS1_2048_8192_SHA256, &google_key().public)
            .verify(input, signature)
            .is_ok()
    })
}

// ── The fake provider ───────────────────────────────────────────────────────

/// One request the fake received.
#[derive(Debug, Clone)]
pub struct Received {
    pub path: String,
    pub method: String,
    pub version: Version,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

impl Received {
    pub fn header(&self, name: &str) -> &str {
        self.headers.get(name).map_or("", String::as_str)
    }

    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap()
    }
}

/// What the fake answers.
#[derive(Debug, Clone)]
pub enum Script {
    /// A status and a body.
    Reply(u16, String),
    /// Never answers, for the timeout.
    Hang,
    /// Starts a body and breaks it.
    Broken,
}

impl Script {
    pub fn json(status: u16, body: &Value) -> Self {
        Self::Reply(status, body.to_string())
    }
}

#[derive(Default)]
struct Inner {
    received: Mutex<Vec<Received>>,
    token_replies: Mutex<VecDeque<Script>>,
    send_replies: Mutex<VecDeque<Script>>,
}

/// Every test in a binary that sends takes its turn, so the log test's call sites are not cached
/// as disabled by a thread with no subscriber (`docs/LEARNINGS.md`).
static SERIAL: Mutex<()> = Mutex::new(());

pub struct FakeProvider {
    pub url: String,
    inner: Arc<Inner>,
    server: tokio::task::JoinHandle<()>,
    _serial: MutexGuard<'static, ()>,
}

async fn answer(State(inner): State<Arc<Inner>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let body = body.collect().await.unwrap().to_bytes();
    let path = parts.uri.path().to_string();
    inner.received.lock().unwrap().push(Received {
        path: path.clone(),
        method: parts.method.to_string(),
        version: parts.version,
        headers: parts
            .headers
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_str().unwrap().to_string()))
            .collect(),
        body: String::from_utf8_lossy(&body).into_owned(),
    });
    let queue = if path == TOKEN_PATH {
        &inner.token_replies
    } else {
        &inner.send_replies
    };
    let scripted = queue.lock().unwrap().pop_front();
    let script = scripted.unwrap_or_else(|| {
        if path == TOKEN_PATH {
            Script::json(
                200,
                &json!({ "access_token": ACCESS_TOKEN, "expires_in": 3599, "token_type": "Bearer" }),
            )
        } else {
            Script::Reply(200, String::new())
        }
    });
    match script {
        Script::Reply(status, body) => Response::builder()
            .status(StatusCode::from_u16(status).unwrap())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
        Script::Hang => {
            tokio::time::sleep(Duration::from_secs(3600)).await;
            unreachable!()
        }
        Script::Broken => Response::builder()
            .status(StatusCode::OK)
            .body(Body::new(BrokenBody {
                started: false,
                pause: Box::pin(tokio::time::sleep(Duration::from_millis(50))),
            }))
            .unwrap(),
    }
}

/// A body that starts and then fails, so the client's read of it breaks.
struct BrokenBody {
    started: bool,
    /// The break comes after the client has the headers, so it is the body read that fails.
    pause: Pin<Box<tokio::time::Sleep>>,
}

impl hyper::body::Body for BrokenBody {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, std::io::Error>>> {
        if self.started {
            return self
                .pause
                .as_mut()
                .poll(cx)
                .map(|()| Some(Err(std::io::Error::other("cut"))));
        }
        self.started = true;
        Poll::Ready(Some(Ok(Frame::data(Bytes::from_static(b"{\"reason\":")))))
    }
}

impl FakeProvider {
    pub async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        let inner = Arc::new(Inner::default());
        let router = Router::new().fallback(answer).with_state(inner.clone());
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            url,
            inner,
            server,
            _serial: serial,
        }
    }

    /// The next sends (APNs or FCM) answer these, in order; then `200`.
    pub fn script_sends(&self, scripts: impl IntoIterator<Item = Script>) {
        self.inner.send_replies.lock().unwrap().extend(scripts);
    }

    /// The next token requests answer these, in order; then a grant of [`ACCESS_TOKEN`].
    pub fn script_tokens(&self, scripts: impl IntoIterator<Item = Script>) {
        self.inner.token_replies.lock().unwrap().extend(scripts);
    }

    pub fn received(&self) -> Vec<Received> {
        self.inner.received.lock().unwrap().clone()
    }

    pub fn token_requests(&self) -> Vec<Received> {
        self.received()
            .into_iter()
            .filter(|r| r.path == TOKEN_PATH)
            .collect()
    }

    pub fn sends(&self) -> Vec<Received> {
        self.received()
            .into_iter()
            .filter(|r| r.path != TOKEN_PATH)
            .collect()
    }

    pub fn apns_endpoints(&self) -> ApnsEndpoints {
        ApnsEndpoints {
            production: format!("{}/production", self.url),
            sandbox: format!("{}/sandbox", self.url),
        }
    }

    pub fn fcm_endpoints(&self) -> FcmEndpoints {
        FcmEndpoints {
            api: self.url.clone(),
            token: format!("{}{TOKEN_PATH}", self.url),
        }
    }
}

impl Drop for FakeProvider {
    fn drop(&mut self) {
        self.server.abort();
    }
}

/// A client that gives up after a short while, so the timeout test is quick.
pub fn quick_client(protocol: Protocol) -> HttpClient {
    HttpClient::new(protocol, Duration::from_millis(300))
}

pub fn apns_sender(fake: &FakeProvider, clock: Arc<ManualClock>) -> ApnsSender {
    ApnsSender::with_client(
        ApnsCredentials {
            key_id: KEY_ID.to_string(),
            team_id: TEAM_ID.to_string(),
            key: Es256Key::from_pem(&apns_key().pem).unwrap(),
        },
        fake.apns_endpoints(),
        clock,
        quick_client(Protocol::Http2Only),
    )
}

pub fn fcm_sender(fake: &FakeProvider, clock: Arc<ManualClock>) -> FcmSender {
    FcmSender::with_client(
        ServiceAccount::from_json(&service_account_json()).unwrap(),
        fake.fcm_endpoints(),
        clock,
        quick_client(Protocol::Negotiated),
    )
}

pub fn rs256_key() -> Rs256Key {
    Rs256Key::from_pem(&google_key().pem).unwrap()
}

/// `"delivered"` and the rest, as `fixtures/push.json` spells the answers.
pub fn answer_named(name: &str) -> ProviderAnswer {
    match name {
        "delivered" => ProviderAnswer::Delivered,
        "token_dead" => ProviderAnswer::TokenDead,
        "retry_later" => ProviderAnswer::RetryLater,
        "rejected" => ProviderAnswer::Rejected,
        other => panic!("unknown answer {other}"),
    }
}
