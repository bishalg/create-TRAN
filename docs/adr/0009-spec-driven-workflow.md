# ADR-0009 Spec-driven workflow

Status: accepted

## Context

Humans and AI agents need one place that says what the system must do.

## Decision

Work goes spec → ADR (if a decision) → failing test → code. Requirements have IDs; tests cite them; `pnpm spec:check` fails on a `verified` requirement without a citing test, or a citation of an unknown ID.

## Consequences

Specs stay honest. Small overhead per change.
