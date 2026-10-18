# ADR-0013 Feature-based web structure

Status: accepted

## Context

Layer folders (components/hooks/utils) scatter one feature.

## Decision

`app/` (shell), `features/<name>/`, `shared/` (ui, api, lib). Tests sit beside code.

## Consequences

Features can be added or removed as a unit.
