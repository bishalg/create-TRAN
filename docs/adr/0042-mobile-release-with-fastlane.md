# ADR-0042 Mobile releases run through fastlane, with placeholders in the repo and credentials in the environment

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [025](../specs/025-mobile-release.md)

## Context

ADR-0034 gave the repo one version and a tagged GitHub release with an unsigned APK, and said "signing belongs to the
fork". That leaves the hardest part of shipping a mobile app undocumented: certificates, provisioning, keystores,
TestFlight and Play uploads. Teams usually solve it once, by hand, on one laptop, and the knowledge lives there.
The mistakes are costly and common: a keystore committed to git, an Apple ID password in CI, a release rebuilt from a
different commit than the one testers approved, a build number bumped by a script that the next release then
contradicts, and a real team id left in a template that every fork inherits.

## Decision

1. **fastlane, pinned.** It is the de facto tool on both platforms and gives iOS and Android the same vocabulary. It
   comes in through a root `Gemfile.lock` and Dependabot, like every other ecosystem (ADR-0033).
2. **Five lanes with the same names on both platforms:** `doctor` (what is missing), `test`, `metadata` (store listing
   text), `beta` (build and upload to testers), `release` (promote the tested build). A person or an agent who knows one platform knows the other.
3. **Lanes are thin.** `test` runs the command the repo already has. Lanes do not bump versions: the version and build
   number come from `pnpm release` (ADR-0034), and `release:check` runs first.
4. **Build once, promote.** `release` never rebuilds. What reaches users is the binary testers ran.
5. **The repo holds placeholders only.** The bundle id is the template's `com.tran.voting`, which the scaffolder
   rewrites. Team ids, store ids, keys, keystores and passwords have no default anywhere: they come from environment
   variables listed in `.env.example`, set in CI secrets or a developer's untracked `.env`. `secrets:check` rejects
   signing files and literal team ids.
6. **Apple: App Store Connect API key and automatic, cloud-managed signing.** An API key authenticates CI without an
   Apple ID, a password or two-factor prompts, and lets `xcodebuild` create and renew certificates and profiles. It
   needs no extra repository. `match` is the alternative for a team that wants certificates in its own private
   storage; the playbook says when to switch.
7. **Android: an upload keystore from the environment, and Play App Signing.** Google holds the app signing key; the
   upload key can be reset if lost. Without the variables the build stays unsigned, so a clone and CI still build.
8. **Delivery is manual and gated.** The workflow runs only by dispatch, reads only repository secrets and skips when
   they are absent, so forks and pull requests are never able to publish and stay green.
9. **Store-readiness is code.** The privacy manifest and the export-compliance key are checked by a test, because
   those are the rejections that arrive after an upload, when they are most expensive.

## Consequences

- The template cannot prove an upload: that needs a project's own Apple and Google accounts. Everything up to the
  upload is tested here (lane structure, the missing-variable check, the unsigned builds). The first real `beta` run is
  the fork's acceptance test, and the playbook lists what to prepare for it.
- Ruby becomes a build-time dependency for releases only. Development, tests and CI gates do not need it.
- Store listing text is generated from the locale dictionaries into `fastlane/metadata` and uploaded by a `metadata`
  lane, so the listing cannot drift from the app. Store screenshots are not automated yet; the screenshot suites are
  the obvious source when a fork wants that.
- A fork that prefers `match`, or Xcode Cloud, replaces the body of two lanes and keeps the names.
