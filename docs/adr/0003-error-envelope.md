# ADR-0003 One error envelope

Status: accepted

## Context

Clients need one predictable failure shape.

## Decision

Every API failure is `{"success":false,"error":"…"}` with a correct HTTP status; extractors' default rejections are mapped into it.

## Consequences

Clients tell input rejection (4xx) from outage (network error). Covered by API tests.
