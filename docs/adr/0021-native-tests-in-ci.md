# ADR-0021 Native tests in a separate, scheduled CI workflow

Status: accepted

## Context

The pull-request gate (`ci.yml`) runs fast checks — Rust/TS unit tests with 100% coverage, spec traceability, BDD/E2E
in Chromium — plus native **build** smoke tests. The real native suites are a different animal: `pnpm ios:test` boots
a simulator and takes ~10 minutes on macOS, `pnpm android:test` boots an emulator with a freshly downloaded system
image and runs Gradle instrumentation. Simulators and emulators are the flakiest part of any CI; blocking every
unrelated PR on them would trade real signal for queue latency.

Alternatives considered: adding the suites to `ci.yml`'s pull-request gate (rejected: slow, flaky, unrelated PRs
blocked); self-hosted runners (rejected: paid infrastructure, see the stop-and-ask rule); running on every push to
`dev` (rejected: nightly is enough signal for a template).

## Decision

`.github/workflows/native-tests.yml` owns the suites, with every action pinned by commit SHA and the same task
runners as the local loop:

- `ios` — `macos-15`, Rust + `aarch64-apple-ios-sim`, XcodeGen, `pnpm ios:test`, uploads the `.xcresult` on failure;
- `android` — `ubuntu-latest` + `reactivecircus/android-emulator-runner` (API 34, x86_64, KVM), `pnpm android:test`,
  uploads the instrumentation reports on failure;
- `maestro` — dispatch-only (`-f maestro=true`), Android emulator, never nightly yet (its XCUITest driver adds its
  own flake surface);
- `notify` — schedule-only: opens or updates one `Nightly native tests are failing` issue when a nightly fails, and
  closes it after a green nightly.

Triggers are `workflow_dispatch` + a nightly cron (04:17 UTC). `ci.yml` gating is unchanged.

## Consequences

- The repository is public, so standard runners are free; macOS runners are still ~10x wall-clock and the emulator
  job downloads a system image. Caching (cargo, Gradle, pnpm store, DerivedData) keeps runs tolerable.
- Promotion rule: after **14 consecutive green nightly runs**, the `ios` and `android` jobs may be added to pull
  requests as path-filtered checks (`apps/ios/**`, `apps/android/**`, `crates/**`, `e2e/maestro/**`). Until then a red
  simulator never blocks an unrelated PR.
- SHA pins mean action updates are deliberate commits; `ci.yml` still tracks tags and can converge later.
- REQ-CI-001 stays `[planned]` until a green dispatch/nightly run exists and is cited.
