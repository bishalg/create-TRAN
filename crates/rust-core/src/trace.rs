//! W3C Trace Context representation and pure propagation operations (spec 023, REQ-OBS-001).
//!
//! Implements the W3C `traceparent` format (`00-<trace_id>-<span_id>-<flags>`) with pure functions
//! that accept injected random bytes so all operations are testable and deterministic.
//! Pinned by `fixtures/trace.json`.

/// Parsed or constructed W3C trace context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceContext {
    /// 32-character lowercase hex trace identifier (16 bytes).
    pub trace_id: String,
    /// 16-character lowercase hex span identifier (8 bytes).
    pub span_id: String,
    /// Whether the sampled flag (bit 0 of flags byte) is set.
    pub sampled: bool,
}

const TRACEPARENT_LEN: usize = 55;
const TRACE_ID_LEN: usize = 32;
const SPAN_ID_LEN: usize = 16;
const VERSION_00: &str = "00";

/// Whether every byte is a lowercase hex character (`0`..=`9`, `a`..=`f`).
#[inline]
pub fn is_lowercase_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Whether `id` is a valid 32-character lowercase hex trace identifier and not all zeros.
pub fn is_valid_trace_id(id: &str) -> bool {
    id.len() == TRACE_ID_LEN && is_lowercase_hex(id) && id.bytes().any(|b| b != b'0')
}

/// Whether `id` is a valid 16-character lowercase hex span identifier and not all zeros.
pub fn is_valid_span_id(id: &str) -> bool {
    id.len() == SPAN_ID_LEN && is_lowercase_hex(id) && id.bytes().any(|b| b != b'0')
}

/// Encodes a byte slice into a lowercase hexadecimal string.
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX_CHARS[(b >> 4) as usize] as char);
        out.push(HEX_CHARS[(b & 0x0f) as usize] as char);
    }
    out
}

const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";

/// Parses a W3C `traceparent` header (REQ-OBS-001).
///
/// Accepts only version `00`, lowercase hex characters, and non-zero trace and span identifiers.
/// Any invalid or malformed header returns `None`.
pub fn parse_traceparent(header: &str) -> Option<TraceContext> {
    if header.len() != TRACEPARENT_LEN {
        return None;
    }
    let parts: Vec<&str> = header.split('-').collect();
    if parts.len() != 4 {
        return None;
    }
    let version = parts[0];
    let trace_id = parts[1];
    let span_id = parts[2];
    let flags_str = parts[3];

    if version != VERSION_00 {
        return None;
    }
    if !is_valid_trace_id(trace_id) || !is_valid_span_id(span_id) {
        return None;
    }
    let flags = match u8::from_str_radix(flags_str, 16) {
        Ok(f) => f,
        Err(_) => return None,
    };
    if !is_lowercase_hex(flags_str) {
        return None;
    }
    let sampled = (flags & 0x01) != 0;

    Some(TraceContext {
        trace_id: trace_id.to_string(),
        span_id: span_id.to_string(),
        sampled,
    })
}

/// Formats a [`TraceContext`] into a W3C `traceparent` header string (`00-<trace_id>-<span_id>-<flags>`).
pub fn format_traceparent(trace: &TraceContext) -> String {
    let flags = if trace.sampled { "01" } else { "00" };
    format!("00-{}-{}-{}", trace.trace_id, trace.span_id, flags)
}

/// Creates a new trace with a root span using injected random bytes (REQ-OBS-001).
///
/// Requires at least 24 random bytes (16 bytes for trace ID and 8 bytes for span ID).
/// Returns `None` if insufficient bytes are provided or if either ID evaluates to all zeros.
pub fn new_trace(random_bytes: &[u8], sampled: bool) -> Option<TraceContext> {
    if random_bytes.len() < 24 {
        return None;
    }
    let trace_bytes = &random_bytes[0..16];
    let span_bytes = &random_bytes[16..24];
    if trace_bytes.iter().all(|&b| b == 0) || span_bytes.iter().all(|&b| b == 0) {
        return None;
    }
    Some(TraceContext {
        trace_id: bytes_to_hex(trace_bytes),
        span_id: bytes_to_hex(span_bytes),
        sampled,
    })
}

/// Derives a child span for an existing trace using injected random bytes (REQ-OBS-001).
///
/// Requires a valid `parent_trace_id` and at least 8 random bytes for the new span ID.
/// Returns `None` if the parent trace ID is invalid, insufficient bytes are provided, or
/// the span ID evaluates to all zeros.
pub fn child_span(
    parent_trace_id: &str,
    random_bytes: &[u8],
    sampled: bool,
) -> Option<TraceContext> {
    if !is_valid_trace_id(parent_trace_id) || random_bytes.len() < 8 {
        return None;
    }
    let span_bytes = &random_bytes[0..8];
    if span_bytes.iter().all(|&b| b == 0) {
        return None;
    }
    Some(TraceContext {
        trace_id: parent_trace_id.to_string(),
        span_id: bytes_to_hex(span_bytes),
        sampled,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-OBS-001
    #[test]
    fn parse_valid_and_invalid_traceparent() {
        let valid = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        let ctx = parse_traceparent(valid).expect("should parse");
        assert_eq!(ctx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert_eq!(ctx.span_id, "00f067aa0ba902b7");
        assert!(ctx.sampled);
        assert_eq!(format_traceparent(&ctx), valid);

        let unsampled = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00";
        let ctx2 = parse_traceparent(unsampled).expect("should parse unsampled");
        assert!(!ctx2.sampled);
        assert_eq!(format_traceparent(&ctx2), unsampled);

        assert_eq!(parse_traceparent(""), None);
        assert_eq!(parse_traceparent("too-short"), None);
        assert_eq!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra"),
            None
        );
        assert_eq!(
            parse_traceparent("01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
            None
        );
        assert_eq!(
            parse_traceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"),
            None
        );
        assert_eq!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"),
            None
        );
        assert_eq!(
            parse_traceparent("00_4bf92f3577b34da6a3ce929d0e0e4736_00f067aa0ba902b7_01"),
            None
        );
        assert_eq!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0g"),
            None
        );
        assert_eq!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0F"),
            None
        );
    }

    // Verifies: REQ-OBS-001
    #[test]
    fn new_trace_and_child_span() {
        let bytes_24 = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        ];
        let root = new_trace(&bytes_24, true).expect("should create trace");
        assert_eq!(root.trace_id, "0102030405060708090a0b0c0d0e0f10");
        assert_eq!(root.span_id, "1112131415161718");
        assert!(root.sampled);

        assert_eq!(new_trace(&[1, 2, 3], true), None);
        let zeros_trace = [0u8; 24];
        assert_eq!(new_trace(&zeros_trace, true), None);
        let mut zeros_span = bytes_24;
        zeros_span[16..24].fill(0);
        assert_eq!(new_trace(&zeros_span, true), None);

        let bytes_8 = [10, 20, 30, 40, 50, 60, 70, 80];
        let child = child_span(&root.trace_id, &bytes_8, false).expect("should create child span");
        assert_eq!(child.trace_id, root.trace_id);
        assert_eq!(child.span_id, "0a141e28323c4650");
        assert!(!child.sampled);

        assert_eq!(child_span("invalid-trace", &bytes_8, true), None);
        assert_eq!(child_span(&root.trace_id, &[1, 2], true), None);
        assert_eq!(child_span(&root.trace_id, &[0u8; 8], true), None);
    }

    // Verifies: REQ-OBS-001
    #[test]
    fn validation_helpers() {
        assert!(is_lowercase_hex("0123456789abcdef"));
        assert!(!is_lowercase_hex("ABC"));
        assert!(!is_lowercase_hex("@"));
        assert!(!is_lowercase_hex("g"));
        assert!(!is_lowercase_hex("0123456789abcdefg"));
        assert!(is_valid_trace_id("0102030405060708090a0b0c0d0e0f10"));
        assert!(!is_valid_trace_id("00000000000000000000000000000000"));
        assert!(!is_valid_trace_id("0102030405060708090a0b0c0d0e0f1g"));
        assert!(!is_valid_trace_id("short"));
        assert!(is_valid_span_id("1112131415161718"));
        assert!(!is_valid_span_id("0000000000000000"));
        assert!(!is_valid_span_id("111213141516171g"));
        assert!(!is_valid_span_id("long1112131415161718"));
    }
}
