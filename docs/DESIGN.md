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

User-visible copy on web SHOULD go through **TranText** variants (see [ATOMIC.md](./ATOMIC.md)) so colour and type stay on the token contract — do not add one-off hex in components.

Native (**N**) apps consume generated platform files:

- `apps/ios/Sources/TranVotingDemo/Generated/BrandTokens.swift`
- `apps/android/app/src/main/kotlin/com/tran/voting/generated/BrandTokens.kt`

The legacy Expo client re-exports `@tran/core` via `apps/native/src/generated/brandTokens.ts`.

## UniFFI (native offline)

Voting rules on iOS/Android do **not** duplicate tokens in Swift/Kotlin — only brand palettes are codegen’d here.
Offline eligibility calls `crates/tran-uniffi`, which wraps `TranEngine` in `rust-core`. Regenerate bindings with
`pnpm uniffi:generate` after changing exported FFI.

## Why Rust-first?

One type-safe contract feeds hex/RGB-friendly JSON, TypeScript, CSS variables, Swift/Kotlin brand tokens, and UniFFI-backed native logic without copy-paste across platforms.
