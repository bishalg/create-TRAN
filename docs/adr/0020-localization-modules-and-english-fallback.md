# ADR-0020 Localization modules, typed accessors and the English fallback

Status: accepted

## Context

[ADR-0019](0019-native-strings-from-dictionaries.md) moved native copy into the shared
dictionaries, but the mechanism did not scale into a template:

- dictionaries were one nested JSON file per locale (`packages/core-ts/src/locales/*.json`),
  so keys were grouped by nothing in particular and every platform invented its own names
  (`app.*` for web, `native.*` for iOS/Android — the same sentence often stored twice);
- consumers read them through `t(key: string)`, so a typo or an invented key compiled;
- only the web header knew the locale list (`['en', 'ne', 'hi']` hard-coded), and the Xcode
  project knew it again (`knownRegions`);
- dead keys (`app.healthy`, `layers.*`, …) surfaced only when someone grepped;
- nothing stopped a hardcoded literal from reappearing on any platform.

The repository is a template others scaffold from, so the mechanism itself must be small,
typed and mechanical to extend, trim or delete.

## Decision

**One module-segmented source of truth.** `locales/<locale>/<module>.json` is the only place
copy lives. Modules are `common`, `shell`, `auth`, `eligibility`, `auditor`, `errors` — they
mirror the feature folders and the navigation destinations, so "where does this string
belong?" has an answer. Keys are `<module>.<group>.<name>` camelCase (`auth.welcome.title`).
The same English value MUST NOT appear in two modules: it moves to `common` (the dedupe gate
fails the build). The locale directories themselves are the only locale list — nothing
downstream hardcodes `en`/`ne`/`hi`.

**English is the base language and the fallback.** There is always visible text: `translate()`
resolves `locale → en → key` (an empty value counts as missing), iOS relies on the String
Catalog `developmentLanguage: en`, Android on the default `values/` folder. English is the
one locale that can never be missing a key.

**Generated, typed accessors per platform.** `tran-tokens-codegen` (behind `pnpm i18n:sync`,
also run from `pnpm tokens:sync`) writes:

- TypeScript: `packages/core-ts/src/generated/strings.json` and `keys.ts`
  (`TRAN_LOCALES`, `SupportedLocale`, the `TranStringKey` union). `t(key, locale, params?)`
  is typed, so an invented key is a compile error.
- iOS: one String Catalog per module under
  `apps/ios/Sources/TranVotingDemo/Generated/Strings/<Module>.xcstrings` plus
  `Generated/L10n.swift` with `L10n.<Module>.<member>` accessors (`Text(L10n.Shell.header("iOS"))`).
- Android: `res/values{,-ne,-hi}/strings_<module>.xml` plus
  `generated/TranStrings.kt` with `@StringRes` accessors (`stringResource(TranStrings.Auth.welcomeTitle)`)
  and a `TranTheme.labelRes` mapping.

The generator validates and prunes: empty values, placeholder mismatches, duplicate English
values, a raw `%` in a value (Android formats), invalid locale folder names, Android resource
or Swift/Kotlin member collisions and missing theme label keys are hard errors; files for
removed locales or modules are deleted (including Android `values-*` folders and the former
single `Localizable.xcstrings`).

**Guard tests, not discipline.** `i18n-guards.test.ts` fails on user-visible literals in web
JSX (parsed with the TypeScript AST, including `aria-label`/`placeholder`/`title`/`alt`), RN
JSX, Swift `Text(`/`Button(`/`NSLocalizedString`, Kotlin `Text(`/`contentDescription` and
literal manifest labels — decorative glyphs are allowed only with a written reason.
The same test proves every dictionary key is referenced by some consumer (no dead keys) and
that the static `index.html` shell matches the English dictionary.

**Placeholders.** Source values use `{name}` camelCase. Codegen converts them to positional
templates — `%1$@` on iOS, `%1$s` on Android — and `interpolate()` fills them on the web; a
missing parameter leaves the literal `{name}` in place rather than rendering a blank.
Pluralization is deliberately deferred (i18next-style selectors or ICU plurals can replace
`interpolate()` without touching the dictionaries).

**Copy unified where the platforms had drifted** (web wording won): native now renders
`auth.welcome.title/subtitle`, `eligibility.age.label` ("Your age"), `eligibility.country.label`
("Country code") and `auditor.subtitle`; the iOS auditor screen title is
`common.role.electionAuditor`. The Nepali/Hindi offline-check button uses the imperative
("ऑफ़लाइन जाँचें") on every platform. Distinct UI contexts keep distinct keys
(`eligibility.age.example` "e.g. 21" for a placeholder vs `eligibility.age.placeholder`
"Enter age").

### Adding a locale

1. Create `locales/<code>/` with the same six module files (copy `en` and translate values).
2. Run `pnpm i18n:sync`.
3. Add the code to `knownRegions` in `apps/ios/project.yml`, then `pnpm ios:project`
   (the parity test fails with this exact instruction until you do).

### Adding a module

1. Create `locales/en/<module>.json` (plus its translations) and make sure no English value
   duplicates another module.
2. Run `pnpm i18n:sync` — TS keys, Swift `L10n`, Kotlin `TranStrings` and resource files are
   generated and exposed under that module name.

### Removing a locale (the template-trim path)

1. Delete `locales/<code>/`.
2. Run `pnpm i18n:sync` — generated TS keys, String Catalogs, `L10n`/`TranStrings` members and
   Android `values-*` files for that locale are pruned (empty folders removed).
3. Remove the code from `knownRegions` in `apps/ios/project.yml` and run `pnpm ios:project`
   (the parity test flags leftovers with an actionable message).

## Consequences

- Renaming copy is a one-line dictionary change plus `pnpm i18n:sync`; key drift between
  platforms is impossible because the accessors are generated.
- Translators work on small, module-scoped files; scaffolding can delete `ne`/`hi` in three
  steps without touching code.
- `%` in a value is rejected: Android format strings need positional placeholders instead.
- The core's English `reason` and validation `detail` are diagnostic only: every UI builds the
  verdict sentence from facts via `eligibility.result.reasonMeets/Below` (REQ-I18N-007).
