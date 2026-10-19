# ADR-0019 Native strings from the shared dictionaries

Status: accepted — kept for the original rationale. The layout it describes (single-file
dictionaries, one `Localizable.xcstrings`, `values*/strings.xml`) is superseded by
[ADR-0020](0020-localization-modules-and-english-fallback.md).

## Context

The web app reads all of its copy from `packages/core-ts/src/locales/{en,ne,hi}.json`, but
`apps/ios` and `apps/android` each still had ~15 hard-coded English strings ("TRAN / iOS",
"Check offline", role buttons, placeholders, the auditor matrix). The Nepali and Hindi
translations were web-only, so the native screens could never render them, and every new
string had to be invented twice.

## Decision

`tran-tokens-codegen` (the binary behind `pnpm tokens:sync`) now also reads the three
locale dictionaries and generates:

- iOS: `apps/ios/Sources/TranVotingDemo/Generated/Localizable.xcstrings` — one String
  Catalog with `en`/`ne`/`hi` localizations for every key, wired into the XcodeGen project
  (`knownRegions: en, ne, hi`);
- Android: `apps/android/app/src/main/res/values{,-ne,-hi}/strings.xml` — resource names
  derive mechanically from the dotted keys (`native.checkOffline` →
  `native_check_offline`);
- Kotlin: `apps/android/app/src/main/kotlin/com/tran/voting/generated/TranStrings.kt` —
  maps each registry theme to its label resource, because Kotlin cannot build `R.string`
  names dynamically.

Views resolve copy by key (`Text("native.checkOffline")`,
`stringResource(R.string.native_check_offline)`), and the theme pickers reuse the existing
`app.themes.*` keys on both platforms. `packages/core-ts/tests/native-strings.test.ts`
fails whenever a generated resource drifts from the dictionaries, and CI's codegen drift
check covers the new files.

The Rust engine's verdict text (`reason` returned from `rust-core`) is still English-only;
localizing it needs locale-aware engine messages and is a known follow-up.

## Consequences

- Adding a language is one JSON file plus `pnpm tokens:sync`; both native platforms pick
  it up on their next build.
- Web-only keys (e.g. `layers.*`) also ship as native resources — negligible dead weight
  at this scale, in exchange for exactly one dictionary per language and no per-platform
  curation list to drift.
- The generated `TranTheme` enums lost their `label` property; labels now come from the
  `app.themes.*` keys so they localize like any other string.
- A guard that bans _new_ hard-coded native copy (SwiftLint/detekt or a script) is future
  work, alongside the native atoms.
