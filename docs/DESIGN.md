# TRAN design tokens

## Single source of truth

All brand and semantic UI tokens live in Rust:

`crates/rust-core/src/tokens.rs` → `default_design_tokens()`

That contract covers typography, spacing, radii, Liquid Glass structure, and light/dark semantic palettes (primary, success, danger, surface, background, text, voting eligibility green/red).

## Changing the brand

1. Edit values in `tokens.rs`.
2. Run `pnpm tokens:sync` (or `nx run rust-core:sync-tokens`).
3. Commit the updated `*/generated/*` files with your change.

Do **not** edit generated TypeScript, CSS, or native stub files by hand — CI runs codegen and fails if they drift.

## Voting UI semantics

- Eligible: `palette.eligibility.canVote` (aligned with `success`)
- Not eligible: `palette.eligibility.cannotVote` (aligned with `danger`)

Web apps import `apps/web/src/styles/generated/theme.css` for CSS variables; React code uses `getThemeTokens()` from `@tran/core`.

## Why Rust-first?

One type-safe contract feeds hex/RGB-friendly JSON, TypeScript, CSS variables, and future Swift/Kotlin outputs without copy-paste across `DESIGN.md` and each platform.
