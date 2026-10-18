# Design token codegen (TRAN)

Brand colors, typography, spacing, and Liquid Glass semantics are defined in **Rust**:

- `crates/rust-core/src/tokens.rs` — `default_design_tokens()` / `get_brand_tokens()`

The `tran-tokens-codegen` binary emits platform artifacts:

| Output | Purpose |
|--------|---------|
| `packages/core-ts/src/generated/tokens.json` | JSON snapshot for tooling |
| `packages/core-ts/src/generated/tokens.ts` | Typed theme API for `@tran/core` |
| `apps/web/src/styles/generated/theme.css` | CSS custom properties (`:root` / `[data-theme]`) |
| `apps/native/src/generated/brandTokens.ts` | RN re-export stub (same contract as web) |

## Commands

```bash
pnpm tokens:sync
# or
nx run rust-core:sync-tokens
```

## Future native generators (not implemented)

When SwiftUI and Jetpack Compose apps land in this template, add generators here:

- `swift/BrandColors.swift` — semantic colors from Rust hex + light/dark pairs
- `kotlin/BrandTokens.kt` — Compose `Color` + `MaterialTheme` extensions

Until then, edit only `tokens.rs` and re-run sync; do not hand-edit files under `*/generated/`.
