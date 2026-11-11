//! An API with a visible rate limit store, a manual clock and a counted session store, driven over
//! a socket peer that the test chooses (spec 031).

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use api::build_app;
use api::clock::ManualClock;
use api::config::AppConfig;
use api::db::{Database, SqlDeviceStore, SqlSessionStore, StoreError};
use api::rate_limit_store::MemoryRateLimitStore;
use api::session_store::{
    LiveSession, PairDigests, Rotation, SessionId, SessionStore, SessionsPruned, StoredSession,
    TokenDigest,
};
use api::sessions::Sessions;
use api::state::AppState;
use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

static SERIAL: Mutex<()> = Mutex::new(());

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub json: Value,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    pub fn retry_after(&self) -> Option<u64> {
        self.header("retry-after").and_then(|v| v.parse().ok())
    }
}

/// A session store that counts how often a request reached it.
pub struct Counted {
    inner: SqlSessionStore,
    pub calls: AtomicUsize,
}

impl Counted {
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    fn count(&self) {
        self.calls.fetch_add(1, Ordering::SeqCst);
    }
}

impl SessionStore for Counted {
    fn start(&self, session: StoredSession, pair: PairDigests) -> Result<SessionId, StoreError> {
        self.count();
        self.inner.start(session, pair)
    }

    fn session_for_access(
        &self,
        access: &TokenDigest,
        now: DateTime<Utc>,
    ) -> Result<Option<LiveSession>, StoreError> {
        self.count();
        self.inner.session_for_access(access, now)
    }

    fn rotate(
        &self,
        refresh: &TokenDigest,
        next: PairDigests,
        now: DateTime<Utc>,
    ) -> Result<Rotation, StoreError> {
        self.count();
        self.inner.rotate(refresh, next, now)
    }

    fn revoke(&self, refresh: &TokenDigest) -> Result<Option<SessionId>, StoreError> {
        self.count();
        self.inner.revoke(refresh)
    }

    fn revoke_user(&self, user_id: &str) -> Result<(), StoreError> {
        self.count();
        self.inner.revoke_user(user_id)
    }

    fn prune(&self, now: DateTime<Utc>) -> Result<SessionsPruned, StoreError> {
        self.count();
        self.inner.prune(now)
    }
}

pub struct RateApi {
    pub state: AppState,
    pub store: Arc<MemoryRateLimitStore>,
    pub clock: Arc<ManualClock>,
    pub sessions: Arc<Counted>,
    /// The socket peer every request comes from; `None` drives the router with no peer at all.
    pub peer: Option<SocketAddr>,
    _serial: MutexGuard<'static, ()>,
}

impl RateApi {
    /// The API configured by `pairs`, holding at most `max_keys` buckets, reached from
    /// `127.0.0.1:12345`.
    pub fn new(pairs: &[(&str, &str)], max_keys: usize) -> Self {
        let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let config = AppConfig::from_lookup(|key| {
            pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
        });
        let start = DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap();
        let clock = Arc::new(ManualClock::starting_at(start));
        let store = Arc::new(MemoryRateLimitStore::new(max_keys));
        let db = Database::in_memory();
        let counted = Arc::new(Counted {
            inner: SqlSessionStore::new(db.clone()),
            calls: AtomicUsize::new(0),
        });
        let mut state = AppState {
            sessions: Sessions::new(
                counted.clone(),
                Arc::new(SqlDeviceStore::new(db)),
                clock.clone(),
            ),
            ..AppState::from_config(&config)
        };
        state.edge.rate_limit_store = store.clone();
        state.edge.clock = clock.clone();
        Self {
            state,
            store,
            clock,
            sessions: counted,
            peer: Some(SocketAddr::from(([127, 0, 0, 1], 12345))),
            _serial: serial,
        }
    }

    pub async fn send(
        &self,
        method: Method,
        uri: &str,
        bearer: Option<&str>,
        headers: &[(&str, &str)],
        body: Body,
    ) -> Reply {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = bearer {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        for (name, val) in headers {
            builder = builder.header(*name, *val);
        }
        if let Some(peer) = self.peer {
            builder = builder.extension(axum::extract::ConnectInfo(peer));
        }
        let request = builder.body(body).unwrap();
        let response = build_app(self.state.clone())
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        Reply {
            status,
            headers,
            json,
        }
    }

    /// `GET /api/v1/vote/countries` (class `read`) as forwarded for `ip`.
    pub async fn read_as(&self, ip: &str, bearer: Option<&str>) -> Reply {
        let headers = [("x-forwarded-for", ip)];
        let headers: &[(&str, &str)] = if ip.is_empty() { &[] } else { &headers };
        self.send(
            Method::GET,
            "/api/v1/vote/countries",
            bearer,
            headers,
            Body::empty(),
        )
        .await
    }

    /// `POST /api/v1/auth/refresh` with `refresh` in the body, as forwarded for `ip`.
    pub async fn refresh_as(&self, ip: &str, refresh: &str) -> Reply {
        let body = json!({ "refresh_token": refresh }).to_string();
        self.send(
            Method::POST,
            "/api/v1/auth/refresh",
            None,
            &[("x-forwarded-for", ip)],
            Body::from(body),
        )
        .await
    }

    /// Signs in on the body transport as forwarded for `ip`: `(access, refresh)`.
    pub async fn sign_in(&self, ip: &str) -> (String, String) {
        let body = json!({ "role": "citizen_voter", "transport": "body" }).to_string();
        let reply = self
            .send(
                Method::POST,
                "/api/v1/auth/session",
                None,
                &[("x-forwarded-for", ip)],
                Body::from(body),
            )
            .await;
        assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.json);
        (
            reply.json["access_token"].as_str().unwrap().to_string(),
            reply.json["refresh_token"].as_str().unwrap().to_string(),
        )
    }
}

/// `tran_rate_limited_total{class}` as the metrics endpoint renders it; `0` before the first.
pub fn limited_total(state: &AppState, class: &str) -> u64 {
    let prefix = format!("tran_rate_limited_total{{class=\"{class}\"}} ");
    state
        .render_metrics()
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .map_or(0, |value| value.trim().parse().unwrap())
}
