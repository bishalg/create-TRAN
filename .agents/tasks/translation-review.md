---
name: translation-review
summary: Translate strings that the Nepali or Hindi dictionaries still show in English.
trigger: schedule
schedule: '37 5 * * 6'
signal: untranslated-strings
mode: edit
deliverable: pr
scope:
  [
    locales/,
    packages/core-ts/src/generated/,
    apps/ios/Sources/TranVotingDemo/Generated/,
    apps/android/app/src/main/kotlin/com/tran/voting/generated/,
    apps/android/app/src/main/res/,
  ]
allow: ['**/generated/', '**/Generated/']
gates: [pnpm test]
max_changed_lines: 150
---

The evidence lists keys whose Nepali or Hindi value is identical to English.

1. Translate each value in `locales/<locale>/<module>.json`. Keep placeholders such as `{years}` exactly as they are.
2. Use natural, standard Devanagari for the language, not a transliteration of the English.
3. Run `pnpm i18n:sync` so the generated web, iOS and Android strings follow. Never edit generated files by hand.

If a value should stay identical (a brand or a code), do not translate it; say so in the hand-off so a person can add
the key to the allowlist in `.agents/policy.json`.
