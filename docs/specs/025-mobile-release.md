# 025 Mobile release automation

Scope: how the iOS app (`apps/ios`) and the Android app (`apps/android`) are signed, built and delivered to TestFlight
and Google Play with fastlane, which identifiers and credentials that needs, where they come from, and what the stores
check before review. Builds on [017](017-release.md) (one version, releases from tags), [016](016-supply-chain.md)
(pinned dependencies) and [022](022-security.md) (no secret in the repo). Rationale:
[ADR-0042](../adr/0042-mobile-release-with-fastlane.md). Playbook: [`../MOBILE_RELEASE.md`](../MOBILE_RELEASE.md).

Vocabulary used below:

- A **lane** is a named fastlane workflow. Both platforms have the same five: `doctor`, `test`, `metadata`, `beta`,
  `release`.
- An **identifier** names the app to a store or to Apple: bundle id, application id, Apple team id, App Store Connect
  app id. It is public but belongs to one project, so the template ships only placeholders.
- A **signing credential** proves who built the app: the App Store Connect API key, the Android upload keystore and
  its passwords, the Play service-account key. These are secrets.

### REQ-MOB-001 [planned] fastlane is pinned like every other dependency

The repo MUST have one root `Gemfile` naming `fastlane` and a committed `Gemfile.lock`; lanes MUST be run through
`bundle exec`. `.github/dependabot.yml` MUST cover the `bundler` ecosystem, and `pnpm supply:check` MUST fail when it
does not.
**Verified by:** `tooling/mobile-release/mobile-release.test.mjs`, `tooling/supply-chain/supply-chain.test.mjs`.

### REQ-MOB-002 [planned] Both platforms have the same lanes

`apps/ios/fastlane/Fastfile` and `apps/android/fastlane/Fastfile` MUST each define exactly the lanes `doctor`, `test`,
`metadata`, `beta` and `release`, each with a description. Root scripts `pnpm ios:lane <lane>` and `pnpm android:lane <lane>` MUST
run them.
**Verified by:** `mobile-release.test.mjs` (parses both files and the scripts).

### REQ-MOB-003 [planned] Lanes reuse the repo's commands and never own the version

The `test` lane MUST run the same command as `pnpm ios:test` / `pnpm android:test`. Every `beta` and `release` lane MUST
first run `pnpm release:check` and stop when it fails. No lane may change a version or a build number (ADR-0034): no
`increment_build_number`, `increment_version_number` or equivalent.
**Verified by:** `mobile-release.test.mjs`.

### REQ-MOB-004 [planned] Identifiers and credentials come from the environment

Fastfiles, Appfiles and Gradle signing configuration MUST read every identifier and credential from an environment
variable. The bundle id and application id MAY default to the template's placeholder (`com.tran.voting`); a team id, a
store app id, a key id, an issuer id, a key, a keystore and a password MUST have no default. Every such variable MUST
be listed in `.env.example` with an empty value and a comment (REQ-SEC-002 covers fastlane and Gradle reads too).
**Verified by:** `mobile-release.test.mjs`, `tooling/secrets/secrets.test.mjs`.

### REQ-MOB-005 [planned] No signing material can be committed

`pnpm secrets:check` MUST fail on a tracked `.p8`, `.p12`, `.mobileprovision`, `.jks` or `.keystore` file, on a Google
service-account key (a JSON file with `"type": "service_account"`), and on a literal Apple team id or App Store Connect
key id assigned in a Fastfile, an Appfile or `apps/ios/project.yml`. The same patterns MUST be in `.gitignore`.
**Verified by:** `secrets.test.mjs`.

### REQ-MOB-006 [planned] `doctor` says what is missing, and delivery lanes refuse to guess

The `doctor` lane MUST print, for its platform, each required variable as set or missing without printing a value, and
exit non-zero when one is missing. `beta` and `release` MUST run the same check first and fail with that list, so a
lane never starts a build it cannot sign or upload.
**Verified by:** `mobile-release.test.mjs` (runs `doctor` with an empty and with a complete fake environment).

### REQ-MOB-007 [planned] `beta` builds once; `release` promotes that build

`beta` MUST build a signed release artefact (an `.ipa`; an `.aab`) and upload it to TestFlight or the Play internal
track. `release` MUST promote a build that is already uploaded (submit the TestFlight build for review; promote the
internal track to production) and MUST NOT build again, so the binary users get is the one that was tested.
**Verified by:** `mobile-release.test.mjs` (lane structure). Uploading is verified by the first real run with a
project's own accounts; see the playbook.

### REQ-MOB-008 [planned] Android signs a release only when the keystore is supplied

`apps/android` MUST sign the release build with the upload keystore named by the environment, and MUST still produce
the unsigned release build of REQ-REL-004 when those variables are absent, so CI and a fresh clone keep building.
**Verified by:** `mobile-release.test.mjs`; `release.yml` keeps building the unsigned APK.

### REQ-MOB-009 [planned] The delivery workflow is manual, gated and uses CI secrets only

`.github/workflows/mobile-release.yml` MUST run only by manual dispatch with a platform and a lane, MUST read
credentials only from repository secrets, MUST skip with a notice (not fail) when they are absent, and MUST pin every
action to a commit SHA (REQ-SUP-003). It MUST NOT run on pull requests.
**Verified by:** `mobile-release.test.mjs`.

### REQ-MOB-010 [planned] The apps declare what the stores check before review

iOS MUST ship a privacy manifest (`PrivacyInfo.xcprivacy`) declaring no tracking, no collected data and the
required-reason APIs the app calls (`UserDefaults`), and MUST set `ITSAppUsesNonExemptEncryption` to `false` in
`Info.plist`. A source guard MUST fail when the app calls a required-reason API category the manifest does not
declare. Android MUST target the API level Google Play currently requires for updates.
**Verified by:** `packages/core-ts/tests/store-readiness.test.ts`.

### REQ-MOB-011 [planned] Store listing text comes from the repo

Each platform MUST keep its store listing text (name, subtitle or short description, description, keywords, release
notes, support and privacy-policy addresses) under `fastlane/metadata`, for every locale the app ships, generated from
the locale dictionaries by `pnpm tokens:sync` so the listing and the app never disagree. A `metadata` lane MUST upload
it (`deliver` on iOS, `supply` on Android) without uploading a binary. A check MUST fail when a locale is missing, a
field exceeds its store limit, or the release notes do not match the current version's changelog section. The
account-deletion address (REQ-ACC-007) and the privacy-policy address MUST be fields of that metadata.
**Verified by:** `mobile-release.test.mjs` (limits, locales, changelog match); the upload by the first real run.
