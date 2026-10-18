# ADR-0004 Inject time and configuration

Status: accepted

## Context

Tests that read the clock or environment are flaky or untestable.

## Decision

Core functions take `today` / config as parameters; only the outermost layer reads the clock or environment (`AppConfig::from_lookup`).

## Consequences

Boundary dates and config branches are tested deterministically.
