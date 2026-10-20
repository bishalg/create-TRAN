//! The error and feedback catalogue for native apps (ADR-0028, spec 011).
//!
//! Swift and Kotlin read the policy — retryability, presentation, toast duration, message key —
//! from here and implement only the mechanics (a toast view, a dialog, a retry loop).

use crate::TranValidationError;
use rust_core::feedback::{
    self, ErrorCode, LogLevel, Presentation, ToastDuration, Tone, UserAction, RETRY_POLICY,
};

/// Declares the native mirror of [`ErrorCode`] and both conversions from one list, so a variant
/// added in `rust-core` fails to compile here until it is mirrored.
macro_rules! mirror_error_codes {
    ($($(#[doc = $doc:literal])* $variant:ident),* $(,)?) => {
        /// A stable failure code. Its wire form (for example `validation.invalid_country_code`) is
        /// [`TranErrorSpec::wire_code`]; everything else about it is in [`error_spec`].
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
        pub enum TranErrorCode {
            $($(#[doc = $doc])* $variant,)*
        }

        impl From<ErrorCode> for TranErrorCode {
            fn from(code: ErrorCode) -> Self {
                match code {
                    $(ErrorCode::$variant => Self::$variant,)*
                }
            }
        }

        impl From<TranErrorCode> for ErrorCode {
            fn from(code: TranErrorCode) -> Self {
                match code {
                    $(TranErrorCode::$variant => Self::$variant,)*
                }
            }
        }
    };
}

mirror_error_codes! {
    /// The age is negative, fractional or above 150.
    ValidationAgeOutOfRange,
    /// The birthdate is after the reference date.
    ValidationBirthdateInFuture,
    /// The country code is not two ASCII letters.
    ValidationInvalidCountryCode,
    /// A date is not `YYYY-MM-DD`.
    ValidationInvalidDate,
    /// The server could not read the request body.
    RequestMalformed,
    /// The request was not sent as JSON.
    RequestUnsupportedMediaType,
    /// The request body is larger than the server accepts.
    RequestTooLarge,
    /// The app cancelled the request itself (for example, the screen closed).
    RequestCancelled,
    /// The server has no such route.
    RouteNotFound,
    /// The route exists but not for this method.
    RouteMethodNotAllowed,
    /// Too many requests; retry later.
    ServerRateLimited,
    /// The server failed unexpectedly.
    ServerInternal,
    /// The server (or a proxy in front of it) is temporarily down.
    ServerUnavailable,
    /// No response at all: no network, or the server is unreachable.
    NetworkOffline,
    /// The request exceeded [`TranRetryPolicy::request_timeout_ms`].
    NetworkTimeout,
    /// A bug in the app itself.
    ClientUnexpected,
}

/// How loudly to log a failure where it is handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranLogLevel {
    /// Expected and harmless (validation).
    Debug,
    /// Expected but worth knowing (offline).
    Info,
    /// Unexpected, recoverable.
    Warn,
    /// A bug or an outage; always investigate.
    Error,
}

/// Colour and icon of a toast.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranToastTone {
    /// Green check mark: something finished.
    Success,
    /// Neutral information.
    Info,
    /// Something to watch.
    Warning,
    /// Something failed.
    Error,
}

/// How long a toast stays up; [`toast_duration_ms`] gives the milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranToastDuration {
    /// 3 s — acknowledgements.
    Short,
    /// 5 s — something to read once.
    Medium,
    /// 10 s — failures that carry a reference id.
    Long,
}

/// The one way an outcome reaches the user (REQ-ERR-006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranPresentation {
    /// Log only; do not interrupt the user.
    Silent,
    /// Show next to the field that caused it, until the input is fixed.
    Inline,
    /// Non-blocking and self-dismissing; pause while the user interacts with it.
    Toast {
        /// Colour and icon.
        tone: TranToastTone,
        /// How long it stays up.
        duration: TranToastDuration,
    },
    /// Persistent and non-blocking; remove it when the condition clears.
    Banner,
    /// Blocking; the user must choose.
    Dialog {
        /// Style the confirm button as destructive and focus Cancel first.
        destructive: bool,
    },
}

/// Everything a native app needs to know about one [`TranErrorCode`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranErrorSpec {
    /// The code this spec describes.
    pub code: TranErrorCode,
    /// The code as it travels in the API envelope's `code` field.
    pub wire_code: String,
    /// Status the API answers with; `None` for failures only a client can observe.
    pub http_status: Option<u16>,
    /// Whether an idempotent request failing with this code may be retried.
    pub retryable: bool,
    /// Level to log at.
    pub log_level: TranLogLevel,
    /// How the user hears about it.
    pub presentation: TranPresentation,
    /// Locale key of the message (`L10n.feedback(_:)` on iOS, `feedbackMessageRes` on Android).
    pub message_key: String,
}

/// A notable outcome of a user action that is not a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranUserAction {
    /// Ends the session — destructive, so it asks first (REQ-ERR-007).
    SignOut,
    /// A server eligibility check completed (REQ-ERR-008).
    ServerCheckSucceeded,
}

/// How a [`TranUserAction`] is presented.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranActionSpec {
    /// The action this spec describes.
    pub action: TranUserAction,
    /// The action's stable name, as in `fixtures/feedback.json`.
    pub wire_name: String,
    /// How the user is asked or told.
    pub presentation: TranPresentation,
    /// Locale key of the headline (the dialog title or the toast text).
    pub message_key: String,
}

/// Retry budget for idempotent requests (REQ-ERR-005).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct TranRetryPolicy {
    /// Total attempts, including the first.
    pub max_attempts: u32,
    /// Base of the exponential backoff.
    pub base_delay_ms: u64,
    /// Ceiling for any single wait, including `Retry-After`.
    pub max_delay_ms: u64,
    /// Per-attempt timeout; exceeding it is [`TranErrorCode::NetworkTimeout`].
    pub request_timeout_ms: u64,
}

fn presentation(p: Presentation) -> TranPresentation {
    match p {
        Presentation::Silent => TranPresentation::Silent,
        Presentation::Inline => TranPresentation::Inline,
        Presentation::Banner => TranPresentation::Banner,
        Presentation::Dialog { destructive } => TranPresentation::Dialog { destructive },
        Presentation::Toast { tone, duration } => TranPresentation::Toast {
            tone: match tone {
                Tone::Success => TranToastTone::Success,
                Tone::Info => TranToastTone::Info,
                Tone::Warning => TranToastTone::Warning,
                Tone::Error => TranToastTone::Error,
            },
            duration: match duration {
                ToastDuration::Short => TranToastDuration::Short,
                ToastDuration::Medium => TranToastDuration::Medium,
                ToastDuration::Long => TranToastDuration::Long,
            },
        },
    }
}

/// The catalogue entry for `code`.
///
/// # Returns
///
/// Status, retryability, log level, presentation and message key, pinned by
/// `fixtures/feedback.json`.
#[uniffi::export]
pub fn error_spec(code: TranErrorCode) -> TranErrorSpec {
    let core = ErrorCode::from(code);
    let spec = core.spec();
    TranErrorSpec {
        code,
        wire_code: core.as_str().to_string(),
        http_status: spec.http_status,
        retryable: spec.retryable,
        log_level: match spec.log_level {
            LogLevel::Debug => TranLogLevel::Debug,
            LogLevel::Info => TranLogLevel::Info,
            LogLevel::Warn => TranLogLevel::Warn,
            LogLevel::Error => TranLogLevel::Error,
        },
        presentation: presentation(spec.presentation),
        message_key: spec.message_key.to_string(),
    }
}

/// Every catalogue entry, in catalogue order (parity tests walk it against the fixture).
#[uniffi::export]
pub fn error_catalogue() -> Vec<TranErrorSpec> {
    ErrorCode::ALL
        .iter()
        .map(|code| error_spec((*code).into()))
        .collect()
}

/// Reads the envelope's `code` field.
///
/// # Returns
///
/// The code, or `None` for a code this build does not know (a newer server) — then classify by
/// status with [`error_code_for_http_status`].
#[uniffi::export]
pub fn error_code_from_wire(raw: String) -> Option<TranErrorCode> {
    ErrorCode::from_wire(&raw).map(Into::into)
}

/// Classifies a non-2xx response whose body carries no `code` (REQ-ERR-004).
#[uniffi::export]
pub fn error_code_for_http_status(status: u16) -> TranErrorCode {
    feedback::code_for_http_status(status).into()
}

/// The code for an offline validation failure, so device and server rejections look the same.
#[uniffi::export]
pub fn error_code_for_validation(error: TranValidationError) -> TranErrorCode {
    match error {
        TranValidationError::AgeOutOfRange => TranErrorCode::ValidationAgeOutOfRange,
        TranValidationError::BirthdateInFuture => TranErrorCode::ValidationBirthdateInFuture,
        TranValidationError::InvalidCountryCode => TranErrorCode::ValidationInvalidCountryCode,
        TranValidationError::InvalidBirthdate | TranValidationError::InvalidReferenceDate => {
            TranErrorCode::ValidationInvalidDate
        }
    }
}

/// How `action` is presented.
#[uniffi::export]
pub fn action_spec(action: TranUserAction) -> TranActionSpec {
    let core = match action {
        TranUserAction::SignOut => UserAction::SignOut,
        TranUserAction::ServerCheckSucceeded => UserAction::ServerCheckSucceeded,
    };
    let spec = core.spec();
    TranActionSpec {
        action,
        wire_name: core.as_str().to_string(),
        presentation: presentation(spec.presentation),
        message_key: spec.message_key.to_string(),
    }
}

/// Milliseconds a toast of `duration` stays up.
#[uniffi::export]
pub fn toast_duration_ms(duration: TranToastDuration) -> u64 {
    match duration {
        TranToastDuration::Short => ToastDuration::Short,
        TranToastDuration::Medium => ToastDuration::Medium,
        TranToastDuration::Long => ToastDuration::Long,
    }
    .millis()
}

/// The retry budget every client uses.
#[uniffi::export]
pub fn retry_policy() -> TranRetryPolicy {
    TranRetryPolicy {
        max_attempts: RETRY_POLICY.max_attempts,
        base_delay_ms: RETRY_POLICY.base_delay_ms,
        max_delay_ms: RETRY_POLICY.max_delay_ms,
        request_timeout_ms: RETRY_POLICY.request_timeout_ms,
    }
}

/// Wait before retry number `retry` (1 = the first retry).
///
/// # Arguments
///
/// * `random` — a value in `[0, 1)`; inject it in tests so the schedule is deterministic.
#[uniffi::export]
pub fn retry_delay_ms(retry: u32, random: f64) -> u64 {
    feedback::retry_delay_ms(retry, random)
}

/// A `Retry-After` header in whole seconds, capped at [`TranRetryPolicy::max_delay_ms`].
///
/// # Returns
///
/// `None` for HTTP dates and junk; then use [`retry_delay_ms`].
#[uniffi::export]
pub fn retry_after_ms(header: String) -> Option<u64> {
    feedback::retry_after_ms(&header)
}

/// Whether a request id (from the envelope or the `x-request-id` header) is safe to log and show:
/// 1–64 characters of `[A-Za-z0-9._-]`. Drop any other id (REQ-ROB-010).
#[uniffi::export]
pub fn is_valid_request_id(value: String) -> bool {
    feedback::is_valid_request_id(&value)
}
