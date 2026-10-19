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
Derived colours (button fills, cards, fields) are `color-mix()` of the theme's own
tokens, so a new palette inherits readable contrast without per-theme overrides. The
web remembers the choice in `localStorage["tran.theme"]` and an inline boot script in
`index.html` applies it before first paint.

## Consequences

A new palette is one entry in `tokens.rs` plus `pnpm tokens:sync`; the web picker, iOS
segmented picker and Android chips pick it up unchanged. The only light/dark branch
left is in generated code keyed on token metadata (`color-scheme` declarations,
`tranColorScheme`) — regenerated, never hand-edited.
