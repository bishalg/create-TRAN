# ADR-0002 Golden fixtures prove parity

Status: accepted

## Context

Several implementations must agree exactly.

## Decision

`fixtures/*.json` holds golden cases read by Rust, TypeScript and native tests.

## Consequences

A rule change edits the fixture first (red), then every implementation goes green. No implementation has private expected values.
