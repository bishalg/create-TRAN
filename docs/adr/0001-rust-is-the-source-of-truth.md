# ADR-0001 Rust is the source of truth for business rules

Status: accepted

## Context

Rules duplicated per platform drift apart.

## Decision

Business rules live in `crates/rust-core`. The API, iOS and Android use it directly (UniFFI); web and shared TypeScript mirror it only where offline use needs it.

## Consequences

TypeScript is a tested mirror; drift is caught by ADR-0002. Changing a rule starts in Rust.
