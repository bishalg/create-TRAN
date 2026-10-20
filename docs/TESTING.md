# Testing playbook (TDD · parity · BDD · E2E · 100% coverage)

The sample is deliberately tiny (one rule: _can this age vote in this country?_) so the **pattern** is
easy to copy. Every layer below has one reference file. Copy its shape, not its domain.

## The pyramid

| Layer                  | Tool                                                | Reference file                                                                                                          | What it proves                                                                             |
| :--------------------- | :-------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| Rule unit tests        | `cargo test`                                        | `crates/rust-core/src/voting.rs` (`mod tests`)                                                                          | Pure functions, boundaries (17/18, leap day)                                               |
| **Golden fixtures**    | `cargo test` + `vitest`                             | `fixtures/vote-eligibility.json` → `crates/rust-core/tests/parity_fixtures.rs`, `packages/core-ts/tests/parity.test.ts` | Rust and TypeScript give **identical** answers                                             |
| UniFFI parity          | `cargo test -p tran-uniffi`                         | `crates/tran-uniffi/tests/{parity,navigation}_fixtures.rs` + `src/lib.rs` unit tests                                    | Native FFI surface matches the same fixture tables (rules, countries, navigation)          |
| **FFI surface**        | vitest source/bindings guard                        | `packages/core-ts/tests/ffi-surface.test.ts`                                                                            | Docs crossed into both bindings, typed enums, generated types extended not redeclared      |
| **Codegen drift**      | `cargo test`                                        | `crates/tran-tokens-codegen/tests/generated_files.rs` + `src/*` unit tests                                              | Every committed generated file is exactly what Rust renders; nothing stale left (ADR-0030) |
| **Failure modes**      | `cargo test` + vitest + XCTest/JUnit                | `fixtures/failure-modes.json` → `apps/api/tests/failure_modes.rs`, `packages/core-ts/tests/failure-modes.test.ts`       | Hostile requests rejected with the right code; every client reads every odd answer alike   |
| **Properties**         | `proptest` + `fast-check`                           | `crates/rust-core/tests/properties.rs`, `packages/core-ts/tests/properties.test.ts`                                     | Invariants over generated input (ages, dates, delays, ids) — the cases nobody writes       |
| Robustness + logs      | `tower::oneshot` + log capture                      | `apps/api/tests/robustness_test.rs` (`tests/support`), `packages/core-ts/tests/robustness.test.ts`                      | Panics, deadline, cancellation; exactly one log event per failure, no payload              |
| **Mutation** (nightly) | `cargo-mutants` + Stryker                           | `.github/workflows/mutation.yml`, `.cargo/mutants.toml`, `packages/core-ts/stryker.config.json`                         | A planted bug makes some test fail — coverage proves code ran, this proves tests notice    |
| HTTP integration       | `tower::oneshot`                                    | `apps/api/tests/api_test.rs`                                                                                            | Routes, headers, status codes, one error envelope                                          |
| Real socket smoke      | tokio `TcpListener`                                 | `apps/api/tests/server_test.rs`                                                                                         | `run_server` really serves                                                                 |
| Client / contract      | vitest + fake `fetch`                               | `packages/core-ts/tests/client.test.ts`                                                                                 | Timeouts, error mapping, Zod contract                                                      |
| **Native API client**  | XCTest stubbed `URLSession` / JUnit `MockWebServer` | `apps/ios/Tests/TranVotingDemoTests/TranApiClientTests.swift`, `apps/android/app/src/test/…/api/TranApiClientTests.kt`  | Base-URL resolution, debug-header gating, offline split — no live API                      |
| Hook / component       | vitest + Testing Library                            | `apps/web/tests/{useTranApi,App}.test.tsx`                                                                              | Behaviour via roles and labels, never CSS                                                  |
| **BDD + E2E**          | Playwright + Gherkin                                | `e2e/features/vote-eligibility.feature`                                                                                 | Real browser → real Vite → real Axum (incl. CORS)                                          |
| **iOS UI + a11y**      | XCTest / XCUITest                                   | `apps/ios/Tests/TranVotingDemoUITests/VotingUITests.swift`                                                              | Journeys on a simulator, `performAccessibilityAudit` per theme, 44pt targets, Dynamic Type |
| **Android + a11y**     | Compose instrumentation                             | `apps/android/app/src/androidTest/…/VotingHomeAccessibilityTest.kt`                                                     | Semantics, `liveRegion`, 48dp touch bounds, 200% font scale, every theme, contrast         |
| **Native smoke**       | Maestro                                             | `e2e/maestro/flows/*.yaml`                                                                                              | The same journeys on a booted simulator/emulator                                           |

## TDD loop (do this for every change)

1. **Red** – write the failing test first. Rule change? Edit `fixtures/vote-eligibility.json` (or
   `fixtures/navigation.json`) first; every language goes red.
2. **Green** – smallest change that passes in Rust, then `pnpm tokens:sync` (TS rule data, ADR-0027) and
   `pnpm uniffi:generate` (native). Never hand-copy a table, limit or message into another language.
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
- **One error shape.** Every API failure is the envelope in [API.md](./API.md#errors) (bad JSON, bad header, rules,
  panics, deadline). Clients classify every failure with `classifyError` — total, it never throws — and only a failure
  of the transport itself means "offline"; a `TypeError` from our code is `client.unexpected` (REQ-ROB-002).
- **Validate at the edge, once, in both languages with the same messages** (they are in the fixture).
- **Accessibility is a test, not a hope.** The axe scenario fails on contrast or missing labels; see [UI.md](./UI.md).
- **Query by role/label** in UI tests (`getByRole`, `getByLabel`). If you can't, the UI isn't accessible: fix the UI.
- **Fakes over mocks.** `apps/web/tests/helpers/fakeApi.ts` reuses the shared rules so it cannot disagree
  with the real thing.
- **Delete dead branches** instead of excluding them from coverage. Excluded files must say why
  (`vitest.config.ts`, root `package.json` `test:rust:coverage`, `.github/workflows/ci.yml`): generated code,
  bootstrap, type-only files, the scaffolder CLI, binary entry points (`main.rs`), and **`crates/tran-uniffi`** (UniFFI
  cdylib/staticlib instrumentation duplicates macro regions; behaviour is covered by parity fixtures and unit
  tests in that crate).
- **Make bugs reproducible first.** The `useTranApi` refetch loop and the missing CORS header both passed every
  old test; they now have a failing-first test (hook test, `cors_preflight_…`, and the E2E API scenario).

## Beyond 100% coverage (ADR-0029)

Coverage says a line ran; it does not say a test would notice the line breaking. Three habits close that gap:

- **Failure modes are rows, not afterthoughts.** A new way to fail is a row in `fixtures/failure-modes.json` (or a
  rejected row in `fixtures/vote-eligibility.json`); every platform's suite picks it up and goes red until handled.
  Check the boundary _and_ one past it (150 accepted, 151 rejected), the empty value, the huge value, the wrong type,
  and the lookalike (`+1` is not a number of seconds, `2000-01-01T00:00:00Z` is not a date).
- **Properties for anything with a range.** State the invariant (`age ≤ MAX_AGE`, delay in `[half, 2 × half]`) and let
  `proptest` / `fast-check` hunt for a counter-example. When one turns up, keep the fix _and_ add the shrunk input as a
  fixture row so every language is checked. Include edge values explicitly — `fast-check` draws `NaN` rarely.
- **Assert the log, not just the result.** Failure tests capture logs (`apps/api/tests/support`, a fake
  `FeedbackLogger`) and assert one `request failed` event with `code`, `status`, `request_id` — and no payload.
- **Mutation is the gate.** Locally: `cargo mutants -p rust-core -p api -p tran-tokens-codegen` and `pnpm --filter @tran/core mutation`.
  A surviving mutant is a missing test — or dead code, which you delete. Only a provably equivalent mutant may be
  listed in `.cargo/mutants.toml`, with the reason. Thresholds may rise, never fall.
- **Logging is linted.** Clippy denies `println!`/`dbg!`/`unwrap()`/`expect()` outside tests (an `expect` that cannot
  fail carries `#[allow(…, reason = "…")]`); ESLint denies `console`; `logging-guards.test.ts` holds Swift and Kotlin to
  their one logger.

## Adding a feature (checklist)

1. Add rows to `fixtures/vote-eligibility.json` (or a new fixture file) — the rejected and failure-mode rows too.
2. Add/extend a scenario in a `.feature` file (plain language, `Scenario Outline` for tables).
3. Red unit tests → implement in `rust-core` → mirror in `core-ts` → route in `apps/api` → UI.
4. Write the step definitions last, reusing existing steps where possible.
5. `pnpm test:all` and update `docs/API.md` if an endpoint changed.
