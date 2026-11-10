# ADR-0045 The template targets the latest platforms only

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [019](../specs/019-code-health.md) (REQ-CODE-004)

## Context

The apps supported iOS 17 and Android 8 (API 26). A template is copied when a project starts, so it never has an
installed base to protect, yet it paid for old versions anyway: two code paths for reverse geocoding, two ways to hide
the recents thumbnail, a notification permission that only exists from Android 13, branches no emulator in CI ever
ran, and deprecated APIs kept because their replacements needed a newer system. Each branch is code a reader has to
understand and that this repo cannot test.

## Decision

1. **iOS supports the current major release and the one before it.** While iOS 27 is current the deployment target is
   26.0.
2. **Android's `minSdk` is 33** (Android 13); `compileSdk` and `targetSdk` are the newest stable level the Play Store
   accepts.
3. **No code below the floor.** Availability checks, version branches and shims for older systems are deleted, and a
   guard keeps them out. A deprecated API with a replacement at the floor is replaced.
4. **The floor moves once a year,** after the autumn releases, in one change that also deletes what it makes
   unnecessary.
5. **The web targets evergreen browsers** (the last two versions of each), as it already did.

## Consequences

- One code path per feature, and every path is one CI can run.
- A fork with existing users on older systems lowers the floor in two files and adds back only the branches it needs;
  the guard tells it where.
- Devices older than about three years cannot run the sample. That is the intended trade for a starting point.
