# ADR-0018 Data-driven theme registry

Status: accepted

## Context

Two hard-coded palettes (light/dark) forced every platform to branch on a boolean
(`if useDark { Dark } else { Light }`). Adding a reading-friendly sepia or a true-black
palette meant touching web, iOS and Android by hand, and each branch could drift.

## Decision

`crates/rust-core/src/tokens.rs` owns an ordered registry of `ThemeModeTokens`
(`light`, `dark`, `black`, `sepia`); each entry carries a `ColorScheme` (light/dark)
plus its semantic colours, and `pnpm tokens:sync` generates:

- CSS: one `[data-theme="<mode>"]` block per theme, each with its own `color-scheme`;
- TypeScript: `themeNames`, `defaultTheme` and `themeTokens` lookups;
- Swift: `TranTheme` + `TranPalette` values and `TranBrandTokens.palette(for:)`;
- Kotlin: `TranTheme` + `BrandPalette` objects and `TranBrandTokens.palette(theme)`.

Screens receive a palette (or look it up by key) and never compare theme names.
Component colours are derived from the theme's own tokens, so a new palette inherits
readable contrast without per-theme overrides: filled actions (`action`/`onAction`)
are computed in Rust — the theme's primary mixed 82/18 toward its own text colour,
labelled with its background token, asserted at 4.5:1 for every palette — and emitted
to CSS (`--tran-color-action`), Swift and Kotlin (`tranColorScheme` maps
`primary`/`onPrimary`), while web cards and fields stay `color-mix()` in CSS. The
web remembers the choice in `localStorage["tran.theme"]` and an inline boot script in
`index.html` applies it before first paint.

## Consequences

A new palette is one entry in `tokens.rs` plus `pnpm tokens:sync`; the web picker, iOS
segmented picker and Android chips pick it up unchanged. The only light/dark branch
left is in generated code keyed on token metadata (`color-scheme` declarations,
`tranColorScheme`) — regenerated, never hand-edited. A palette that cannot keep filled
actions at 4.5:1 fails `every_theme_keeps_action_fill_above_aa_contrast` in `tokens.rs`
before it can ship.
