//! W3C Trace Context UniFFI surface for native apps (spec 023, REQ-OBS-001).
//!
//! Swift and Kotlin send `traceparent` on every API request, reusing the trace ID across
//! retries and token refreshes with fresh child spans. Pinned by `fixtures/trace.json`.

use rust_core::trace::{self, TraceContext};

/// A parsed or constructed W3C trace context.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranTraceContext {
    /// 32-character lowercase hex trace identifier.
    pub trace_id: String,
    /// 16-character lowercase hex span identifier.
    pub span_id: String,
    /// Whether the sampled flag is set.
    pub sampled: bool,
}

impl From<TraceContext> for TranTraceContext {
    fn from(ctx: TraceContext) -> Self {
        Self {
            trace_id: ctx.trace_id,
            span_id: ctx.span_id,
            sampled: ctx.sampled,
        }
    }
}

impl From<TranTraceContext> for TraceContext {
    fn from(ctx: TranTraceContext) -> Self {
        Self {
            trace_id: ctx.trace_id,
            span_id: ctx.span_id,
            sampled: ctx.sampled,
        }
    }
}

/// Parses a W3C `traceparent` header string (REQ-OBS-001).
///
/// Accepts only version `00`, lowercase hex, non-zero trace and span identifiers.
#[uniffi::export]
pub fn parse_traceparent_offline(header: String) -> Option<TranTraceContext> {
    trace::parse_traceparent(&header).map(Into::into)
}

/// Formats a [`TranTraceContext`] into a W3C `traceparent` header string.
#[uniffi::export]
pub fn format_traceparent_offline(context: TranTraceContext) -> String {
    trace::format_traceparent(&context.into())
}

/// Creates a new trace with a root span using injected random bytes (REQ-OBS-001).
#[uniffi::export]
pub fn new_trace_offline(random_bytes: Vec<u8>, sampled: bool) -> Option<TranTraceContext> {
    trace::new_trace(&random_bytes, sampled).map(Into::into)
}

/// Derives a child span from a parent trace ID using injected random bytes (REQ-OBS-001).
#[uniffi::export]
pub fn child_span_offline(
    trace_id: String,
    random_bytes: Vec<u8>,
    sampled: bool,
) -> Option<TranTraceContext> {
    trace::child_span(&trace_id, &random_bytes, sampled).map(Into::into)
}
