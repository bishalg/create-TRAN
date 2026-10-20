# ADR-0010 TanStack Start for server rendering

Status: proposed — not implemented. `apps/web` is a plain Vite + React SPA; the unused `@tanstack/*`
dependencies were removed until REQ-SEO-001..012 are built (all `[planned]`).

## Context

SEO and social cards need complete HTML on first response.

## Decision

The web app uses TanStack Start (SSR, server functions, server routes) on Vite 8.

## Consequences

Metadata, sitemap, robots and OG images are served by the same app. Requires Vite 8 and its plugin order (`tanstackStart()` before `react()`).
