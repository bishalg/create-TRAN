# Testing playbook (TDD · parity · BDD · E2E · 100% coverage)

The sample is deliberately tiny (one rule: _can this age vote in this country?_) so the **pattern** is
easy to copy. Every layer below has one reference file. Copy its shape, not its domain.

## The pyramid

| Layer                 | Tool                                                | Reference file                                                                                                          | What it proves                                                                             |
| :-------------------- | :-------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| Rule unit tests       | `cargo test`                                        | `crates/rust-core/src/voting.rs` (`mod tests`)                                                                          | Pure functions, boundaries (17/18, leap day)                                               |
| **Golden fixtures**   | `cargo test` + `vitest`                             | `fixtures/vote-eligibility.json` → `crates/rust-core/tests/parity_fixtures.rs`, `packages/core-ts/tests/parity.test.ts` | Rust and TypeScript give **identical** answers                                             |
| UniFFI parity         | `cargo test -p tran-uniffi`                         | `crates/tran-uniffi/tests/parity_fixtures.rs` + `src/lib.rs` unit tests                                                 | Native FFI surface matches the same fixture table                                          |
| HTTP integration      | `tower::oneshot`                                    | `apps/api/tests/api_test.rs`                                                                                            | Routes, headers, status codes, one error envelope                                          |
| Real socket smoke     | tokio `TcpListener`                                 | `apps/api/tests/server_test.rs`                                                                                         | `run_server` really serves                                                                 |
| Client / contract     | vitest + fake `fetch`                               | `packages/core-ts/tests/client.test.ts`                                                                                 | Timeouts, error mapping, Zod contract                                                      |
| **Native API client** | XCTest stubbed `URLSession` / JUnit `MockWebServer` | `apps/ios/Tests/TranVotingDemoTests/TranApiClientTests.swift`, `apps/android/app/src/test/…/api/TranApiClientTests.kt`  | Base-URL resolution, debug-header gating, offline split — no live API                      |
| Hook / component      | vitest + Testing Library                            | `apps/web/tests/{useTranApi,App}.test.tsx`                                                                              | Behaviour via roles and labels, never CSS                                                  |
| **BDD + E2E**         | Playwright + Gherkin                                | `e2e/features/vote-eligibility.feature`                                                                                 | Real browser → real Vite → real Axum (incl. CORS)                                          |
| **iOS UI + a11y**     | XCTest / XCUITest                                   | `apps/ios/Tests/TranVotingDemoUITests/VotingUITests.swift`                                                              | Journeys on a simulator, `performAccessibilityAudit` per theme, 44pt targets, Dynamic Type |
| **Android + a11y**    | Compose instrumentation                             | `apps/android/app/src/androidTest/…/VotingHomeAccessibilityTest.kt`                                                     | Semantics, `liveRegion`, 48dp touch bounds, 200% font scale, every theme, contrast         |
| **Native smoke**      | Maestro                                             | `e2e/maestro/flows/*.yaml`                                                                                              | The same journeys on a booted simulator/emulator                                           |

## TDD loop (do this for every change)

1. **Red** – write the failing test first. Rule change? Edit `fixtures/vote-eligibility.json` first; both
   languages go red.
2. **Green** – smallest change that passes. Rust is the source of truth; mirror in `packages/core-ts`.
3. **Refactor** with the suite green.
4. `pnpm test:all` before pushing.

## Commands

```bash
pnpm test                 # cargo test + vitest (fast)
pnpm test:coverage        # Rust + TS, FAILS below 100%
pnpm test:e2e             # Gherkin scenarios in Chromium (starts API + web itself)
pnpm ios:test             # XCTest + XCUITest (client stubs, accessibility audits) on the first available iPhone simulator
pnpm android:test         # JVM unit tests + Compose instrumentation on a booted emulator (builds the Rust .so first)
pnpm e2e:maestro          # Maestro smoke flows on the booted simulator/emulator (--device to choose)
pnpm test:all             # everything CI runs
pnpm check:quick          # spec check + formatting + typecheck + clippy (matches pre-commit hook)
pnpm hooks:install        # configure git core.hooksPath .githooks (runs automatically on pnpm install)
```

Native runs need a booted simulator/emulator; keep the emulator awake (`adb shell svc power stayon true`)
or the Compose rule finds no resumed activity. Neither native suite needs `pnpm dev:api`: the API client
tests stub the transport (URLSession / MockWebServer) and the offline journeys point at a refused port. Android's Gradle `preBuild` stages
`libtran_uniffi.so` for `arm64-v8a`/`x86_64` (`apps/android/scripts/build-rust-lib.sh`, NDK clang
linkers), so the device check exercises the real Rust core. `connectedDebugAndroidTest` uninstalls
the app when it finishes — reinstall the built APK before Maestro:
`adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk`.

First E2E run needs `pnpm --filter e2e exec playwright install chromium`.

### Native suites in CI

`.github/workflows/native-tests.yml` runs the same suites nightly (04:17 UTC) and on demand — pull requests are
never blocked by a flaky simulator until the promotion rule is met ([ADR-0021](./adr/0021-native-tests-in-ci.md)):

```bash
gh workflow run native-tests.yml --ref <branch>                  # iOS + Android suites
gh workflow run native-tests.yml -f maestro=true --ref <branch>  # …plus the Maestro smoke flows (Android)
```

A failing nightly opens or updates one tracking issue; a green nightly closes it. After **14 consecutive green
nightly runs** the `ios` and `android` jobs become path-filtered pull-request checks.

## Rules that keep it robust

- **Inject the world.** Never read the clock/env inside a rule. `evaluate_vote_eligibility_on(.., today)`
  and `AppConfig::from_lookup(..)` are testable; `Utc::now()` / `env::var` live in one thin wrapper.
- **One error shape.** Every API failure is `{ "success": false, "error": "…" }` (bad JSON, bad header, rules).
  Clients map it to `TranApiError`; only _network_ failures (`isNetworkError`) mean "offline".
- **Validate at the edge, once, in both languages with the same messages** (they are in the fixture).
- **Accessibility is a test, not a hope.** The axe scenario fails on contrast or missing labels; see [UI.md](./UI.md).
- **Query by role/label** in UI tests (`getByRole`, `getByLabel`). If you can't, the UI isn't accessible: fix the UI.
- **Fakes over mocks.** `apps/web/tests/helpers/fakeApi.ts` reuses the shared rules so it cannot disagree
  with the real thing.
- **Delete dead branches** instead of excluding them from coverage. Excluded files must say why
  (`vitest.config.ts`, root `package.json` `test:rust:coverage`, `.github/workflows/ci.yml`): generated code,
  bootstrap, type-only files, the scaffolder CLI, token codegen binaries, and **`crates/tran-uniffi`** (UniFFI
  cdylib/staticlib instrumentation duplicates macro regions; behaviour is covered by parity fixtures and unit
  tests in that crate).
- **Make bugs reproducible first.** The `useTranApi` refetch loop and the missing CORS header both passed every
  old test; they now have a failing-first test (hook test, `cors_preflight_…`, and the E2E API scenario).

## Adding a feature (checklist)

1. Add rows to `fixtures/vote-eligibility.json` (or a new fixture file).
2. Add/extend a scenario in a `.feature` file (plain language, `Scenario Outline` for tables).
3. Red unit tests → implement in `rust-core` → mirror in `core-ts` → route in `apps/api` → UI.
4. Write the step definitions last, reusing existing steps where possible.
5. `pnpm test:all` and update `docs/API.md` if an endpoint changed.
