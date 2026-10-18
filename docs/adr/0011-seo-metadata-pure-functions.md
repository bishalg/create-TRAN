# ADR-0011 SEO metadata is built by pure functions

Status: accepted

## Context

Head tags scattered in components are untestable and inconsistent.

## Decision

Pure functions turn loader data into title, meta, links and JSON-LD; routes only call them. OG images are rendered by satori + resvg.

## Consequences

Limits (title ≤60, description 50–160) are unit-tested; BDD checks the raw HTML.
