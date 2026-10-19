# 008 Localization

Scope: the shared dictionaries in `locales/` and every generated platform artifact.
Rationale: [ADR-0020](../adr/0020-localization-modules-and-english-fallback.md) (supersedes the
layout described in [ADR-0019](../adr/0019-native-strings-from-dictionaries.md)).

### REQ-I18N-001 [verified] One module-segmented source of truth

Every user-visible string MUST live in `locales/<locale>/<module>.json` (modules: `common`,
`shell`, `auth`, `eligibility`, `auditor`, `errors`); keys MUST be `<module>.<group>.<name>`
camelCase; two modules MUST NOT duplicate the same English value (share it via `common`);
generated artifacts MUST NOT be edited by hand.
**Verified by:** [`i18n.test.ts`](../../packages/core-ts/tests/i18n.test.ts),
[`native-strings.test.ts`](../../packages/core-ts/tests/native-strings.test.ts),
[`i18n-guards.test.ts`](../../packages/core-ts/tests/i18n-guards.test.ts).

### REQ-I18N-002 [verified] English is the base language and the fallback

Lookups MUST resolve `locale → en → key`; a missing or empty translation MUST NEVER render
blank — the English value MUST be shown (iOS through the String Catalog development language,
Android through the default `values/` folder).
**Verified by:** [`i18n.test.ts`](../../packages/core-ts/tests/i18n.test.ts) fallback and
interpolation tests; BDD "Switching the language localizes the whole interface".

### REQ-I18N-003 [verified] Parity, placeholders and build-time validation

Every locale MUST define exactly `en`'s key set with non-empty values and identical `{name}`
placeholders; the generator MUST fail on validity errors (empty value, placeholder mismatch,
duplicate English value across modules, a raw `%` in a value, invalid locale folder name,
Android resource / Swift-Kotlin member collision, missing theme label keys).
**Verified by:** [`i18n.test.ts`](../../packages/core-ts/tests/i18n.test.ts),
[`native-strings.test.ts`](../../packages/core-ts/tests/native-strings.test.ts), and the unit
tests in `crates/tran-tokens-codegen/src/main.rs`.

### REQ-I18N-004 [verified] Typed accessors only — no literals, no dead keys

Consumers MUST read copy through generated typed accessors — `t()` with the
`TranStringKey` union (web, RN), `L10n` (iOS), `TranStrings` (Android); user-visible
literals MUST fail the guard tests, and every dictionary key MUST be referenced by at least
one consumer.
**Verified by:** [`i18n-guards.test.ts`](../../packages/core-ts/tests/i18n-guards.test.ts),
[`native-strings.test.ts`](../../packages/core-ts/tests/native-strings.test.ts).

### REQ-I18N-005 [verified] Generated artifacts and sync

`pnpm i18n:sync` (the `tran-tokens-codegen` binary) MUST write the TypeScript strings and
key union, the per-module iOS String Catalogs and `L10n.swift`, the Android
`strings_<module>.xml` files and `TranStrings.kt`, MUST delete stale generated files when a
locale or module is removed, and CI MUST fail on drift.
**Verified by:** [`native-strings.test.ts`](../../packages/core-ts/tests/native-strings.test.ts);
the `rust-check` workflow's `git diff --exit-code` drift gate.

### REQ-I18N-006 [verified] The locale set is data-driven

The directories under `locales/` MUST be the only definition of which languages ship:
`TRAN_LOCALES`, the Android `values*` folders, the String Catalog localizations and the iOS
`knownRegions` guard MUST all follow them; removing a locale MUST be delete-directory +
`pnpm i18n:sync` + `project.yml` edit, and language switching MUST be verified end to end.
**Verified by:** [`native-strings.test.ts`](../../packages/core-ts/tests/native-strings.test.ts)
(knownRegions, no stale resource folders); BDD "Switching the language localizes the whole interface".
