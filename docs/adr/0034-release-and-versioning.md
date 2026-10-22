# ADR-0034: One version, conventional commits, releases from tags

**Status:** Accepted · **Date:** 2026-10-22 · **Spec:** [017](../specs/017-release.md)

## Context

The template had no releases. The version `0.1.0` was written by hand in ten places: six `package.json` files, the
Cargo workspace, iOS `MARKETING_VERSION`, Android `versionName`, and as a string inside the CLI. The iOS and Android
build numbers were `1` and nothing would ever change them, yet both stores reject a build number that does not
increase. There was no changelog, so a fork could not tell what changed between two copies of the template. Commit
messages were mostly conventional by habit, not by rule.

## Decision

1. **The root `package.json` version is the version of everything.** The monorepo ships one product on three
   platforms; independent package versions (Changesets) would add a per-package release process that a hello-world
   template and most of its forks do not need. Packages published separately can opt out later.
2. **Build numbers are derived:** `major × 1,000,000 + minor × 1,000 + patch`. Monotonic, reproducible from the
   version alone and well under Android's limit; no counter to store. Two builds of the same version need a patch
   bump.
3. **Conventional Commits, enforced by a zero-dependency `commit-msg` hook** that calls the release tool, in line with
   ADR-0016. No commitlint dependency.
4. **`tooling/release/release.mjs`** (plain Node, no dependencies) checks versions, bumps them, writes the changelog
   from `git log` since the last `v*` tag, and prints release notes for one version. It never tags or pushes:
   publishing stays a deliberate human step.
5. **A tag push runs `release.yml`**: verify tag equals version, run the tests, build the web app and the unsigned
   Android release APK, publish a GitHub release with the changelog section as notes. iOS is not attached: an
   unsigned simulator build is not installable by users; signing belongs to the fork.
6. **The API's contract version is the product version** (`/health` already reports it). A breaking change to the
   oRPC contract is a breaking commit (`feat!:`), which bumps the major. Contract tests that detect such a change
   without relying on the author are a later step (roadmap: API contract tests).

## Consequences

- `pnpm release:check` in CI catches a hand-edited version anywhere.
- Releasing is: `pnpm release auto`, read the diff, commit, `git tag vX.Y.Z`, push both.
- The first changelog section covers the whole history up to it, since no earlier tag exists.
- Commits that fail the hook must be reworded; `git commit --no-verify` remains possible, and the changelog then lists
  such a commit under "Other changes".
