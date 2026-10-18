# ADR-0012 Browser calls the API directly

Status: accepted

## Context

A server-side proxy adds a hop and hides the real contract.

## Decision

Interactive checks go from the browser to the API; server functions are used only to load data for server rendering.

## Consequences

One contract to test. CORS must be configured per environment.
