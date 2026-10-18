# ADR-0006 100% coverage gate

Status: accepted

## Context

A template should show the bar, not an aspiration.

## Decision

Rust (cargo-llvm-cov) and TypeScript (vitest v8) coverage thresholds are 100%; every exclusion is justified in config.

## Consequences

Untested code cannot merge; exclusions are visible in review.
