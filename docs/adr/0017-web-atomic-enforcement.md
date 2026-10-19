# ADR-0017: Web atomic UI and ESLint enforcement

## Status

Accepted

## Context

The web sample accumulated inline `style={{}}`, local `--space-*` / `--radius-*` aliases, and raw semantic HTML outside a shared atom layer. That drifted from the rust-core token contract and made cross-platform (iOS/Android) naming harder to align.

## Decision

1. Extend `crates/rust-core/src/tokens.rs` with semantic typography, full spacing scale (including legacy `0.75rem` as `spacing.base`), and export all `--tran-*` variables via `tran-tokens-codegen`.
2. Require feature code to compose **atoms** under `apps/web/src/shared/ui/` (`TranText`, `TranStack`, `TranInline`, `TranBox`, `TranSurface`, `TranButton`, `TranTable`, `Field`, `TranLabel`) with `data-*` hooks in CSS — no inline styles.
3. Enforce with ESLint flat config in `apps/web` and a Vitest `tokens-guard.test.ts` scan of `app.css`.

## Consequences

- Visual tweaks flow from `pnpm tokens:sync` instead of component-level hex/px.
- Native apps will mirror the same atom names when SwiftUI/Compose wrappers land.
- CI runs `pnpm --filter web lint` in addition to coverage and E2E.
