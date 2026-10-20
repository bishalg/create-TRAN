//! Error and feedback policy — the single table every layer reads (ADR-0028, spec 011).
//!
//! Each failure has a stable [`ErrorCode`]; each code (and each notable [`UserAction`]) decides its
//! HTTP status, retryability, log level, how the user hears about it ([`Presentation`]) and the
//! locale key of its message. `pnpm tokens:sync` generates this table for TypeScript, Swift and
//! Kotlin; `fixtures/feedback.json` pins every copy. Platforms implement the mechanics (a toast, a
//! dialog, a retry loop) — never the policy.

use crate::validation::VoteValidationError;

/// How loudly a failure is logged where it is handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// Colour and icon of a toast.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Success,
    Info,
    Warning,
    Error,
}

impl Tone {
    pub const ALL: [Self; 4] = [Self::Success, Self::Info, Self::Warning, Self::Error];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

/// How long a toast stays up before it dismisses itself (paused while hovered or focused).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastDuration {
    /// Acknowledgements: "done", "saved".
    Short,
    /// Something the user should read once.
    Medium,
    /// Failures that carry a reference id.
    Long,
}

impl ToastDuration {
    pub const ALL: [Self; 3] = [Self::Short, Self::Medium, Self::Long];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Short => "short",
            Self::Medium => "medium",
            Self::Long => "long",
        }
    }

    pub fn millis(self) -> u64 {
        match self {
            Self::Short => 3_000,
            Self::Medium => 5_000,
            Self::Long => 10_000,
        }
    }
}

/// The one way an outcome reaches the user (REQ-ERR-006).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presentation {
    /// Logged only; the user is not interrupted.
    Silent,
    /// Next to the field that caused it, until the input is fixed.
    Inline,
    /// Non-blocking and self-dismissing.
    Toast { tone: Tone, duration: ToastDuration },
    /// Persistent and non-blocking; removed when the condition clears.
    Banner,
    /// Blocking; the user must choose.
    Dialog { destructive: bool },
}

/// Everything the platforms need to know about one error code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorSpec {
    /// Status the API answers with; `None` for failures only a client can observe.
    pub http_status: Option<u16>,
    /// Whether an idempotent request failing with this code may be retried (REQ-ERR-005).
    pub retryable: bool,
    pub log_level: LogLevel,
    pub presentation: Presentation,
    /// Full locale key (`module.key`) of the user-facing message.
    pub message_key: &'static str,
}

/// Stable, machine-readable failure codes. Never rename one; add a new variant instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorCode {
    ValidationAgeOutOfRange,
    ValidationBirthdateInFuture,
    ValidationInvalidCountryCode,
    ValidationInvalidDate,
    RequestMalformed,
    RequestUnsupportedMediaType,
    /// The body is larger than the server accepts (REQ-ROB-004).
    RequestTooLarge,
    RequestCancelled,
    RouteNotFound,
    RouteMethodNotAllowed,
    ServerRateLimited,
    ServerInternal,
    ServerUnavailable,
    NetworkOffline,
    NetworkTimeout,
    /// A bug in the client itself; never produced by the server.
    ClientUnexpected,
}

const fn spec(
    http_status: Option<u16>,
    retryable: bool,
    log_level: LogLevel,
    presentation: Presentation,
    message_key: &'static str,
) -> ErrorSpec {
    ErrorSpec {
        http_status,
        retryable,
        log_level,
        presentation,
        message_key,
    }
}

const INLINE: Presentation = Presentation::Inline;
const ERROR_TOAST: Presentation = Presentation::Toast {
    tone: Tone::Error,
    duration: ToastDuration::Medium,
};

impl ErrorCode {
    /// Every code, in catalogue order (codegen and fixtures follow this order).
    pub const ALL: [Self; 16] = [
        Self::ValidationAgeOutOfRange,
        Self::ValidationBirthdateInFuture,
        Self::ValidationInvalidCountryCode,
        Self::ValidationInvalidDate,
        Self::RequestMalformed,
        Self::RequestUnsupportedMediaType,
        Self::RequestTooLarge,
        Self::RequestCancelled,
        Self::RouteNotFound,
        Self::RouteMethodNotAllowed,
        Self::ServerRateLimited,
        Self::ServerInternal,
        Self::ServerUnavailable,
        Self::NetworkOffline,
        Self::NetworkTimeout,
        Self::ClientUnexpected,
    ];

    /// The wire value (`"validation.invalid_country_code"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ValidationAgeOutOfRange => "validation.age_out_of_range",
            Self::ValidationBirthdateInFuture => "validation.birthdate_in_future",
            Self::ValidationInvalidCountryCode => "validation.invalid_country_code",
            Self::ValidationInvalidDate => "validation.invalid_date",
            Self::RequestMalformed => "request.malformed",
            Self::RequestUnsupportedMediaType => "request.unsupported_media_type",
            Self::RequestTooLarge => "request.too_large",
            Self::RequestCancelled => "request.cancelled",
            Self::RouteNotFound => "route.not_found",
            Self::RouteMethodNotAllowed => "route.method_not_allowed",
            Self::ServerRateLimited => "server.rate_limited",
            Self::ServerInternal => "server.internal",
            Self::ServerUnavailable => "server.unavailable",
            Self::NetworkOffline => "network.offline",
            Self::NetworkTimeout => "network.timeout",
            Self::ClientUnexpected => "client.unexpected",
        }
    }

    /// Parses a wire value; unknown codes (a newer server) are `None` so callers fall back to the
    /// HTTP status ([`code_for_http_status`]).
    pub fn from_wire(code: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|candidate| candidate.as_str() == code)
    }

    pub fn spec(self) -> ErrorSpec {
        use LogLevel::{Debug, Error, Info, Warn};
        match self {
            Self::ValidationAgeOutOfRange => {
                spec(Some(400), false, Debug, INLINE, "errors.ageOutOfRange")
            }
            Self::ValidationBirthdateInFuture => {
                spec(Some(400), false, Debug, INLINE, "errors.birthdateInFuture")
            }
            Self::ValidationInvalidCountryCode => {
                spec(Some(400), false, Debug, INLINE, "errors.countryInvalid")
            }
            Self::ValidationInvalidDate => {
                spec(Some(400), false, Debug, INLINE, "errors.dateInvalid")
            }
            Self::RequestMalformed => spec(
                Some(400),
                false,
                Warn,
                ERROR_TOAST,
                "errors.requestMalformed",
            ),
            Self::RequestUnsupportedMediaType => spec(
                Some(415),
                false,
                Warn,
                ERROR_TOAST,
                "errors.requestMalformed",
            ),
            Self::RequestTooLarge => spec(
                Some(413),
                false,
                Warn,
                ERROR_TOAST,
                "errors.requestMalformed",
            ),
            Self::RequestCancelled => spec(
                None,
                false,
                Debug,
                Presentation::Silent,
                "errors.requestCancelled",
            ),
            Self::RouteNotFound => spec(Some(404), false, Warn, ERROR_TOAST, "errors.notFound"),
            Self::RouteMethodNotAllowed => {
                spec(Some(405), false, Warn, ERROR_TOAST, "errors.notFound")
            }
            Self::ServerRateLimited => spec(
                Some(429),
                true,
                Warn,
                Presentation::Toast {
                    tone: Tone::Warning,
                    duration: ToastDuration::Medium,
                },
                "errors.rateLimited",
            ),
            Self::ServerInternal => spec(
                Some(500),
                true,
                Error,
                Presentation::Toast {
                    tone: Tone::Error,
                    duration: ToastDuration::Long,
                },
                "errors.serverInternal",
            ),
            Self::ServerUnavailable => spec(
                Some(503),
                true,
                Warn,
                Presentation::Banner,
                "errors.serverUnavailable",
            ),
            Self::NetworkOffline => spec(
                None,
                true,
                Info,
                Presentation::Banner,
                "eligibility.offlineNotice",
            ),
            Self::NetworkTimeout => spec(None, true, Info, Presentation::Banner, "errors.timeout"),
            Self::ClientUnexpected => spec(
                None,
                false,
                Error,
                Presentation::Toast {
                    tone: Tone::Error,
                    duration: ToastDuration::Long,
                },
                "errors.unexpected",
            ),
        }
    }
}

impl From<VoteValidationError> for ErrorCode {
    fn from(err: VoteValidationError) -> Self {
        match err {
            VoteValidationError::AgeOutOfRange => Self::ValidationAgeOutOfRange,
            VoteValidationError::BirthdateInFuture => Self::ValidationBirthdateInFuture,
            VoteValidationError::InvalidCountryCode => Self::ValidationInvalidCountryCode,
        }
    }
}

/// Classifies a non-2xx response whose body carries no `code` (a proxy, an old server).
pub fn code_for_http_status(status: u16) -> ErrorCode {
    match status {
        404 => ErrorCode::RouteNotFound,
        405 => ErrorCode::RouteMethodNotAllowed,
        413 => ErrorCode::RequestTooLarge,
        415 => ErrorCode::RequestUnsupportedMediaType,
        429 => ErrorCode::ServerRateLimited,
        502..=504 => ErrorCode::ServerUnavailable,
        400..=499 => ErrorCode::RequestMalformed,
        _ => ErrorCode::ServerInternal,
    }
}

/// Notable outcomes of user actions that are not failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserAction {
    /// Destructive: ends the session, so it asks first (REQ-ERR-007).
    SignOut,
    /// A server check completed (REQ-ERR-008).
    ServerCheckSucceeded,
}

/// How a [`UserAction`] is presented, and the locale key of its headline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActionSpec {
    pub presentation: Presentation,
    pub message_key: &'static str,
}

impl UserAction {
    pub const ALL: [Self; 2] = [Self::SignOut, Self::ServerCheckSucceeded];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::SignOut => "sign_out",
            Self::ServerCheckSucceeded => "server_check_succeeded",
        }
    }

    pub fn spec(self) -> ActionSpec {
        match self {
            Self::SignOut => ActionSpec {
                presentation: Presentation::Dialog { destructive: true },
                message_key: "auth.signOutConfirm.title",
            },
            Self::ServerCheckSucceeded => ActionSpec {
                presentation: Presentation::Toast {
                    tone: Tone::Success,
                    duration: ToastDuration::Short,
                },
                message_key: "eligibility.serverCheckDone",
            },
        }
    }
}

/// Retry budget for idempotent requests (REQ-ERR-005).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Total attempts, including the first.
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    /// Per-attempt timeout; exceeding it is [`ErrorCode::NetworkTimeout`].
    pub request_timeout_ms: u64,
}

pub const RETRY_POLICY: RetryPolicy = RetryPolicy {
    max_attempts: 3,
    base_delay_ms: 200,
    max_delay_ms: 2_000,
    request_timeout_ms: 5_000,
};

/// How long the API lets one request run before answering [`ErrorCode::ServerUnavailable`]. Shorter
/// than [`RetryPolicy::request_timeout_ms`] so a client always receives the envelope, never its own
/// timeout (REQ-ROB-004).
pub const SERVER_DEADLINE_MS: u64 = 4_000;
const _: () = assert!(
    SERVER_DEADLINE_MS < RETRY_POLICY.request_timeout_ms,
    "the server must give up before the client does"
);

/// The longest request id anyone accepts; see [`is_valid_request_id`].
pub const REQUEST_ID_MAX_LEN: usize = 64;

/// 1–[`REQUEST_ID_MAX_LEN`] characters of `[A-Za-z0-9._-]`. The API replaces anything else; clients
/// drop it. Ids are logged and shown to users, so they must be inert (REQ-ROB-010).
pub fn is_valid_request_id(value: &str) -> bool {
    (1..=REQUEST_ID_MAX_LEN).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// The one log event every platform emits for a failure, and its fixed fields (REQ-ROB-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogEvent {
    pub message: &'static str,
    pub fields: &'static [&'static str],
}

pub const LOG_EVENT: LogEvent = LogEvent {
    message: "request failed",
    fields: &["code", "status", "request_id"],
};

/// Wait before retry number `retry` (1 = the first retry), with "equal jitter":
/// `half + random × half`, `half = min(max, base × 2^(retry−1)) / 2`. `random` is in `[0, 1)` and
/// injected so the schedule is testable.
pub fn retry_delay_ms(retry: u32, random: f64) -> u64 {
    let exponential = RETRY_POLICY
        .base_delay_ms
        .saturating_mul(1u64 << retry.saturating_sub(1).min(16));
    let half = exponential.min(RETRY_POLICY.max_delay_ms) / 2;
    half + (random.clamp(0.0, 1.0) * half as f64) as u64
}

/// A `Retry-After` header given in whole seconds (`1*DIGIT`, RFC 9110), capped at the policy's
/// maximum delay. HTTP dates and junk — `+1` included, which `str::parse` would accept — are
/// ignored (`None`), so the client falls back to [`retry_delay_ms`]. Too many digits for a `u64`
/// is still "a long time", so it saturates like the TypeScript mirror.
pub fn retry_after_ms(header: &str) -> Option<u64> {
    let digits = header.trim();
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let seconds = digits.parse::<u64>().unwrap_or(u64::MAX);
    Some(seconds.saturating_mul(1_000).min(RETRY_POLICY.max_delay_ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_unique_dotted_snake_case() {
        let codes: std::collections::BTreeSet<&str> =
            ErrorCode::ALL.iter().map(|c| c.as_str()).collect();
        assert_eq!(codes.len(), ErrorCode::ALL.len());
        assert!(codes.iter().all(|code| {
            code.split_once('.').is_some_and(|(area, name)| {
                !area.is_empty()
                    && !name.is_empty()
                    && code
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b == b'.' || b == b'_')
            })
        }));
    }

    #[test]
    fn wire_values_round_trip_and_unknown_codes_are_none() {
        for code in ErrorCode::ALL {
            assert_eq!(ErrorCode::from_wire(code.as_str()), Some(code));
        }
        assert_eq!(ErrorCode::from_wire("future.code"), None);
    }

    #[test]
    fn validation_errors_map_to_inline_codes() {
        for err in VoteValidationError::ALL {
            assert_eq!(
                ErrorCode::from(err).spec().presentation,
                Presentation::Inline
            );
        }
    }

    #[test]
    fn server_failures_are_the_only_error_level_logs() {
        for code in ErrorCode::ALL {
            let spec = code.spec();
            let is_5xx = spec.http_status.is_some_and(|s| s >= 500);
            assert_eq!(
                spec.log_level == LogLevel::Error,
                matches!(
                    code,
                    ErrorCode::ServerInternal | ErrorCode::ClientUnexpected
                ),
                "{code:?}"
            );
            if !is_5xx && spec.http_status.is_some() {
                assert_ne!(spec.log_level, LogLevel::Error, "{code:?}");
            }
        }
    }

    #[test]
    fn every_toast_duration_has_a_name() {
        let names: Vec<&str> = ToastDuration::ALL.iter().map(|d| d.as_str()).collect();
        assert_eq!(names, ["short", "medium", "long"]);
        let tones: Vec<&str> = Tone::ALL.iter().map(|t| t.as_str()).collect();
        assert_eq!(tones, ["success", "info", "warning", "error"]);
    }

    #[test]
    fn huge_retry_numbers_saturate_at_the_cap() {
        assert_eq!(retry_delay_ms(64, 0.0), RETRY_POLICY.max_delay_ms / 2);
        assert_eq!(retry_delay_ms(0, 0.0), RETRY_POLICY.base_delay_ms / 2);
    }
}
