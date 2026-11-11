// Verifies: REQ-OBS-001
//! W3C Trace Context fixtures from `fixtures/trace.json`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use rust_core::trace::{
    child_span, format_traceparent, new_trace, parse_traceparent, TraceContext,
};
use serde::Deserialize;

const FIXTURE: &str = include_str!("../../../fixtures/trace.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TraceFixtures {
    parse_valid: Vec<ParseValidCase>,
    parse_invalid: Vec<ParseInvalidCase>,
    format_cases: Vec<FormatCase>,
    new_trace_cases: Vec<NewTraceCase>,
    child_span_cases: Vec<ChildSpanCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedContext {
    trace_id: String,
    span_id: String,
    sampled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseValidCase {
    name: String,
    header: String,
    expected: ExpectedContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseInvalidCase {
    name: String,
    header: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormatCase {
    context: ExpectedContext,
    expected_header: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTraceCase {
    name: String,
    random_bytes: Vec<u8>,
    sampled: bool,
    expected: Option<ExpectedContext>,
    expected_header: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChildSpanCase {
    name: String,
    parent_trace_id: String,
    random_bytes: Vec<u8>,
    sampled: bool,
    expected: Option<ExpectedContext>,
    expected_header: Option<String>,
}

fn fixture() -> TraceFixtures {
    serde_json::from_str(FIXTURE).expect("fixtures/trace.json is valid JSON")
}

// Verifies: REQ-OBS-001
#[test]
fn parse_valid_matches_the_fixture() {
    let fixtures = fixture();
    for case in fixtures.parse_valid {
        let parsed = parse_traceparent(&case.header)
            .unwrap_or_else(|| panic!("case '{}' failed to parse: {}", case.name, case.header));
        assert_eq!(
            parsed.trace_id, case.expected.trace_id,
            "trace_id mismatch in case '{}'",
            case.name
        );
        assert_eq!(
            parsed.span_id, case.expected.span_id,
            "span_id mismatch in case '{}'",
            case.name
        );
        assert_eq!(
            parsed.sampled, case.expected.sampled,
            "sampled mismatch in case '{}'",
            case.name
        );
    }
}

// Verifies: REQ-OBS-001
#[test]
fn parse_invalid_matches_the_fixture() {
    let fixtures = fixture();
    for case in fixtures.parse_invalid {
        assert!(
            parse_traceparent(&case.header).is_none(),
            "case '{}' should fail to parse but succeeded: {}",
            case.name,
            case.header
        );
    }
}

// Verifies: REQ-OBS-001
#[test]
fn format_cases_match_the_fixture() {
    let fixtures = fixture();
    for case in fixtures.format_cases {
        let ctx = TraceContext {
            trace_id: case.context.trace_id,
            span_id: case.context.span_id,
            sampled: case.context.sampled,
        };
        assert_eq!(format_traceparent(&ctx), case.expected_header);
    }
}

// Verifies: REQ-OBS-001
#[test]
fn new_trace_cases_match_the_fixture() {
    let fixtures = fixture();
    for case in fixtures.new_trace_cases {
        let res = new_trace(&case.random_bytes, case.sampled);
        match (res, case.expected, case.expected_header) {
            (Some(ctx), Some(expected), Some(expected_header)) => {
                assert_eq!(ctx.trace_id, expected.trace_id, "case '{}'", case.name);
                assert_eq!(ctx.span_id, expected.span_id, "case '{}'", case.name);
                assert_eq!(ctx.sampled, expected.sampled, "case '{}'", case.name);
                assert_eq!(
                    format_traceparent(&ctx),
                    expected_header,
                    "case '{}'",
                    case.name
                );
            }
            (None, None, None) => {}
            (other_res, other_exp, _) => {
                panic!(
                    "case '{}' unexpected result: res={:?}, expected={:?}",
                    case.name, other_res, other_exp
                );
            }
        }
    }
}

// Verifies: REQ-OBS-001
#[test]
fn child_span_cases_match_the_fixture() {
    let fixtures = fixture();
    for case in fixtures.child_span_cases {
        let res = child_span(&case.parent_trace_id, &case.random_bytes, case.sampled);
        match (res, case.expected, case.expected_header) {
            (Some(ctx), Some(expected), Some(expected_header)) => {
                assert_eq!(ctx.trace_id, expected.trace_id, "case '{}'", case.name);
                assert_eq!(ctx.span_id, expected.span_id, "case '{}'", case.name);
                assert_eq!(ctx.sampled, expected.sampled, "case '{}'", case.name);
                assert_eq!(
                    format_traceparent(&ctx),
                    expected_header,
                    "case '{}'",
                    case.name
                );
            }
            (None, None, None) => {}
            (other_res, other_exp, _) => {
                panic!(
                    "case '{}' unexpected result: res={:?}, expected={:?}",
                    case.name, other_res, other_exp
                );
            }
        }
    }
}
