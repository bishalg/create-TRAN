//! The FCM HTTP v1 sender (REQ-PSH-005, ADR-0046), switched off until a service account is set.
//!
//! Protocol, as Google documents it:
//!
//! - "Send a message using FCM HTTP v1 API"
//!   (<https://firebase.google.com/docs/cloud-messaging/send/v1-api>):
//!   `POST https://fcm.googleapis.com/v1/projects/<project>/messages:send` with
//!   `Authorization: Bearer <access token>`, the access token minted for the scope
//!   `https://www.googleapis.com/auth/firebase.messaging`.
//! - "Using OAuth 2.0 for Server to Server Applications"
//!   (<https://developers.google.com/identity/protocols/oauth2/service-account>): an RS256 JWT
//!   (`iss` the service account's email, `scope`, `aud` the token endpoint, `iat`, `exp` at most an
//!   hour later) posted as `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and
//!   `assertion=<JWT>` to `https://oauth2.googleapis.com/token`; the answer's `access_token` is
//!   reused until shortly before `expires_in` runs out.
//! - "ErrorCode" (<https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode>): the
//!   error's `details[].errorCode` (`UNREGISTERED`, `INVALID_ARGUMENT`, `QUOTA_EXCEEDED`, ...),
//!   else its `status`; an `INVALID_ARGUMENT` names the bad field in a `google.rpc.BadRequest`
//!   detail (`fieldViolations[].field`). Mapped by [`fcm_answer`].
//!
//! Nothing here logs a token, the service account's key, the JWT or the access token.

use std::sync::{Arc, Mutex, PoisonError};

use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};

use super::jwt::Rs256Key;
use super::sender::{fcm_answer, ProviderAnswer, PushMessage, PushSender, SendFuture};
use super::transport::{HttpClient, Protocol, DEFAULT_TIMEOUT};
use crate::clock::Clock;
use crate::devices::Registration;
use crate::secret::Secret;

pub const FCM_API: &str = "https://fcm.googleapis.com";
pub const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

/// The lifetime asked for in the JWT: Google's maximum.
const ASSERTION_LIFETIME: Duration = Duration::hours(1);

/// An access token is replaced this long before Google says it expires.
pub const FCM_TOKEN_MARGIN: Duration = Duration::minutes(5);

const JWT_BEARER: &str = "urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer";

/// Where the sender posts; [`FcmEndpoints::google`] in production, a fake server in tests. The
/// JWT's `aud` is always [`GOOGLE_TOKEN_ENDPOINT`], wherever the exchange is posted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FcmEndpoints {
    pub api: String,
    pub token: String,
}

impl FcmEndpoints {
    pub fn google() -> Self {
        Self {
            api: FCM_API.to_string(),
            token: GOOGLE_TOKEN_ENDPOINT.to_string(),
        }
    }
}

/// The fields of a service account's JSON key the sender uses.
#[derive(Debug)]
pub struct ServiceAccount {
    pub project_id: String,
    pub client_email: String,
    /// Sent as the JWT's `kid`.
    pub private_key_id: String,
    pub key: Rs256Key,
}

impl ServiceAccount {
    /// Reads a service account's JSON key. `Err` names the first field missing or unusable,
    /// never a value.
    pub fn from_json(json: &str) -> Result<Self, &'static str> {
        let value: Value = serde_json::from_str(json).map_err(|_| "the JSON")?;
        let text = |field: &'static str| {
            value[field]
                .as_str()
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
                .ok_or(field)
        };
        let key = Rs256Key::from_pem(&text("private_key")?).ok_or("private_key")?;
        Ok(Self {
            project_id: text("project_id")?,
            client_email: text("client_email")?,
            private_key_id: text("private_key_id")?,
            key,
        })
    }
}

struct CachedToken {
    access: Secret,
    expires_at: DateTime<Utc>,
}

pub struct FcmSender {
    account: ServiceAccount,
    endpoints: FcmEndpoints,
    client: HttpClient,
    clock: Arc<dyn Clock>,
    token: Mutex<Option<CachedToken>>,
}

impl FcmSender {
    pub fn new(account: ServiceAccount, endpoints: FcmEndpoints, clock: Arc<dyn Clock>) -> Self {
        Self::with_client(
            account,
            endpoints,
            clock,
            HttpClient::new(Protocol::Negotiated, DEFAULT_TIMEOUT),
        )
    }

    /// As [`new`](Self::new), with a client of the caller's (a shorter timeout in tests).
    pub fn with_client(
        account: ServiceAccount,
        endpoints: FcmEndpoints,
        clock: Arc<dyn Clock>,
        client: HttpClient,
    ) -> Self {
        Self {
            account,
            endpoints,
            client,
            clock,
            token: Mutex::new(None),
        }
    }

    /// The signed assertion exchanged for an access token, issued now.
    pub fn assertion(&self) -> String {
        let now = self.clock.now();
        let header = json!({ "alg": "RS256", "typ": "JWT", "kid": self.account.private_key_id });
        let claims = json!({
            "iss": self.account.client_email,
            "scope": FCM_SCOPE,
            "aud": GOOGLE_TOKEN_ENDPOINT,
            "iat": now.timestamp(),
            "exp": (now + ASSERTION_LIFETIME).timestamp(),
        });
        self.account.key.sign(&header, &claims)
    }

    fn cached_token(&self, now: DateTime<Utc>) -> Option<Secret> {
        self.token
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .filter(|token| now + FCM_TOKEN_MARGIN < token.expires_at)
            .map(|token| token.access.clone())
    }

    fn forget_token(&self) {
        *self.token.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    /// An access token: the cached one until [`FCM_TOKEN_MARGIN`] before it expires, else a new
    /// one from the token endpoint. A refusal there is `Rejected` (the account is wrong), a
    /// failure to reach it `RetryLater`.
    async fn access_token(&self) -> Result<Secret, ProviderAnswer> {
        let now = self.clock.now();
        if let Some(token) = self.cached_token(now) {
            return Ok(token);
        }
        let form = format!("grant_type={JWT_BEARER}&assertion={}", self.assertion());
        let headers = [("content-type", "application/x-www-form-urlencoded")];
        let reply = self
            .client
            .post(&self.endpoints.token, &headers, form.into_bytes())
            .await
            .ok_or(ProviderAnswer::RetryLater)?;
        let status = reply.status;
        let body: Value = serde_json::from_slice(&reply.body).unwrap_or(Value::Null);
        let granted = body["access_token"].as_str().filter(|_| status == 200);
        let Some(access) = granted else {
            tracing::warn!(
                provider = "fcm",
                status,
                "google refused the access token request"
            );
            let answer = if status >= 500 {
                ProviderAnswer::RetryLater
            } else {
                ProviderAnswer::Rejected
            };
            return Err(answer);
        };
        let lifetime = body["expires_in"].as_i64().unwrap_or(0);
        let access = Secret::new(access);
        *self.token.lock().unwrap_or_else(PoisonError::into_inner) = Some(CachedToken {
            access: access.clone(),
            expires_at: now + Duration::seconds(lifetime),
        });
        Ok(access)
    }

    async fn post(&self, registration: &Registration, message: &Value) -> ProviderAnswer {
        let access = match self.access_token().await {
            Ok(access) => access,
            Err(answer) => return answer,
        };
        let mut body = message.clone();
        body["message"]["token"] = json!(registration.token.expose());
        let url = format!(
            "{}/v1/projects/{}/messages:send",
            self.endpoints.api, self.account.project_id
        );
        let bearer = format!("Bearer {}", access.expose());
        let headers = [
            ("authorization", bearer.as_str()),
            ("content-type", "application/json; charset=utf-8"),
        ];
        let Some(reply) = self
            .client
            .post(&url, &headers, body.to_string().into_bytes())
            .await
        else {
            tracing::warn!(provider = "fcm", "push transport failed; retry later");
            return ProviderAnswer::RetryLater;
        };
        let status = reply.status;
        let error = fcm_error(&reply.body);
        if status == 401 {
            self.forget_token();
        }
        let answer = fcm_answer(status, error.code.as_deref(), error.names_token);
        if answer == ProviderAnswer::Rejected {
            let code = error.code.unwrap_or_default();
            tracing::warn!(provider = "fcm", status, code, "fcm refused the push");
        }
        answer
    }
}

/// What an FCM error body says, in [`fcm_answer`]'s terms.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct FcmError {
    /// `details[].errorCode` when present, else `error.status`.
    pub code: Option<String>,
    /// A `fieldViolations[].field` is `message.token`.
    pub names_token: bool,
}

/// Reads an FCM v1 error body; an empty or unreadable one says nothing.
pub fn fcm_error(body: &[u8]) -> FcmError {
    let value: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let error = &value["error"];
    let details = error["details"].as_array().cloned().unwrap_or_default();
    let detail_code = details
        .iter()
        .find_map(|detail| detail["errorCode"].as_str().map(str::to_owned));
    let names_token = details.iter().any(|detail| {
        detail["fieldViolations"]
            .as_array()
            .is_some_and(|fields| fields.iter().any(|f| f["field"] == "message.token"))
    });
    FcmError {
        code: detail_code.or_else(|| error["status"].as_str().map(str::to_owned)),
        names_token,
    }
}

impl PushSender for FcmSender {
    fn send<'a>(
        &'a self,
        registration: &'a Registration,
        message: &'a PushMessage,
    ) -> SendFuture<'a> {
        Box::pin(async move {
            match message {
                PushMessage::Fcm(body) => self.post(registration, body).await,
                PushMessage::Apns(_) => ProviderAnswer::Rejected,
            }
        })
    }
}
