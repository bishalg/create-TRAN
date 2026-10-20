# Design token codegen (TRAN)

Brand colors, typography, spacing, and Liquid Glass semantics are defined in **Rust**:

- `crates/rust-core/src/tokens.rs` — `default_design_tokens()` / `get_brand_tokens()`

The **in-repo** `tran-tokens-codegen` binary (not a separate project — [ADR-0025](../../docs/adr/0025-tokens-codegen-stays-in-repo.md)) emits platform artifacts. Destinations are configured in [`codegen.json`](./codegen.json).

| Output (defaults)                                                           | Purpose                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/core-ts/src/generated/tokens.json`                                | JSON snapshot for tooling                                                             |
| `packages/core-ts/src/generated/tokens.ts`                                  | Typed theme API for `@tran/core`                                                      |
| `apps/web/src/styles/generated/theme.css`                                   | CSS custom properties (`:root` / `[data-theme]`)                                      |
| `apps/ios/Sources/TranVotingDemo/Generated/BrandTokens.swift`               | SwiftUI semantic colors (light/dark)                                                  |
| `apps/android/app/src/main/kotlin/com/tran/voting/generated/BrandTokens.kt` | Compose `Color` tokens                                                                |
| `DESIGN.md` (repo root)                                                     | [Google DESIGN.md](https://github.com/google-labs-code/design.md) for agents / Stitch |

## Commands

```bash
pnpm tokens:sync
# or
nx run rust-core:sync-tokens
```

## Renaming the sample

Update `codegen.json` (`ios_generated_dir`, `android_kotlin_generated_dir`,
`android_kotlin_package`, `android_app_package`), move or regenerate the native trees, then
`pnpm tokens:sync`. Keep the binary in this workspace until a second consumer needs a published crate.

## Native mobile (**N**)

TRAN **N** is **Swift (iOS)** and **Kotlin (Android)**, not React Native. Edit only `tokens.rs` and re-run sync; do not hand-edit files under `*/generated/` or `Generated/`.
