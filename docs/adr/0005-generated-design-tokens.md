# ADR-0005 Design tokens are generated

Status: accepted

## Context

Hand-copied colours diverge across web, iOS and Android.

## Decision

One tokens source feeds `crates/tran-tokens-codegen`, which emits TS, CSS, Swift and Kotlin. Components use tokens only.

## Consequences

CI fails on generated-file drift. Generated files are excluded from formatting and coverage.
