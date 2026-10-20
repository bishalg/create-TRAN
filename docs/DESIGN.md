# TRAN design tokens (pipeline)

> **Brand contract for agents / Stitch:** the generated Google-format file is
> [`DESIGN.md`](../DESIGN.md) at the repo root (`pnpm tokens:sync`).  
> **This page** explains how to change tokens in Rust. Do not confuse the two.

## Single source of truth

All brand and semantic UI tokens live in Rust:

`crates/rust-core/src/tokens.rs` → `default_design_tokens()`

That contract covers typography, spacing, radii, Liquid Glass structure, and a theme registry (`light`, `dark`, `black`, `sepia`) of semantic palettes (primary, success, danger, surface, background, text, voting eligibility green/red), each tagged light or dark.

## Changing the brand

1. Edit values in `tokens.rs`.
2. Run `pnpm tokens:sync` (or `nx run rust-core:sync-tokens`).
3. Commit the updated generated files with your change — including root **`DESIGN.md`**.

Do **not** edit generated TypeScript, CSS, native stubs, or `DESIGN.md` by hand — regenerate from Rust ([ADR-0026](./adr/0026-design-md-from-rust.md)).

Output paths and Android package names live in
[`tooling/design-tokens/codegen.json`](../tooling/design-tokens/codegen.json). Edit that file when
renaming the iOS module, Android package, or `design_md_path`; the converter binary stays in this monorepo
([ADR-0025](./adr/0025-tokens-codegen-stays-in-repo.md)).

## What `tokens:sync` writes

| Artifact                                  | Purpose                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/core-ts/src/generated/*`        | TS tokens + i18n keys                                                                 |
| `apps/web/src/styles/generated/theme.css` | CSS variables                                                                         |
| iOS / Android `Generated/*`               | Swift / Kotlin brand + strings                                                        |
| **`DESIGN.md` (repo root)**               | [Google DESIGN.md](https://github.com/google-labs-code/design.md) for agents & Stitch |

## Voting UI semantics

- Eligible: `palette.eligibility.canVote` (aligned with `success`)
- Not eligible: `palette.eligibility.cannotVote` (aligned with `danger`)

Web apps import `apps/web/src/styles/generated/theme.css` for CSS variables; React code uses `getThemeTokens()` from `@tran/core`.

User-visible copy on web SHOULD go through **TranText** variants (see [ATOMIC.md](./ATOMIC.md)) so colour and type stay on the token contract — do not add one-off hex in components.

Native (**N**) apps consume generated platform files:

- `apps/ios/Sources/TranVotingDemo/Generated/BrandTokens.swift`
- `apps/android/app/src/main/kotlin/com/tran/voting/generated/BrandTokens.kt`

## UniFFI (native offline)

Voting rules on iOS/Android do **not** duplicate tokens in Swift/Kotlin — only brand palettes are codegen’d here.
Offline eligibility calls `crates/tran-uniffi`, which wraps `TranEngine` in `rust-core`. Regenerate bindings with
`pnpm uniffi:generate` after changing exported FFI.

## Why Rust-first?

One type-safe contract feeds hex/RGB-friendly JSON, TypeScript, CSS variables, Swift/Kotlin brand tokens, UniFFI-backed native logic, and a Stitch-ready `DESIGN.md` without copy-paste across platforms.
