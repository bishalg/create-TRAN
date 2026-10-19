# Design token codegen (TRAN)

Brand colors, typography, spacing, and Liquid Glass semantics are defined in **Rust**:

- `crates/rust-core/src/tokens.rs` — `default_design_tokens()` / `get_brand_tokens()`

The `tran-tokens-codegen` binary emits platform artifacts:

| Output                                                                      | Purpose                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/core-ts/src/generated/tokens.json`                                | JSON snapshot for tooling                        |
| `packages/core-ts/src/generated/tokens.ts`                                  | Typed theme API for `@tran/core`                 |
| `apps/web/src/styles/generated/theme.css`                                   | CSS custom properties (`:root` / `[data-theme]`) |
| `apps/ios/Sources/TranVotingDemo/Generated/BrandTokens.swift`               | SwiftUI semantic colors (light/dark)             |
| `apps/android/app/src/main/kotlin/com/tran/voting/generated/BrandTokens.kt` | Compose `Color` tokens                           |

## Commands

```bash
pnpm tokens:sync
# or
nx run rust-core:sync-tokens
```

## Native mobile (**N**)

TRAN **N** is **Swift (iOS)** and **Kotlin (Android)**, not React Native. Edit only `tokens.rs` and re-run sync; do not hand-edit files under `*/generated/` or `Generated/`.

Future work: fuller glass/blur tokens on native, typography from snapshot, and CI build smoke for both apps.
