# Testing playbook (TDD · parity · BDD · E2E · 100% coverage)

The sample is deliberately tiny (one rule: _can this age vote in this country?_) so the **pattern** is
easy to copy. Every layer below has one reference file. Copy its shape, not its domain.

## The pyramid

| Layer               | Tool                        | Reference file                                                                                                          | What it proves                                    |
| :------------------ | :-------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| Rule unit tests     | `cargo test`                | `crates/rust-core/src/voting.rs` (`mod tests`)                                                                          | Pure functions, boundaries (17/18, leap day)      |
| **Golden fixtures** | `cargo test` + `vitest`     | `fixtures/vote-eligibility.json` → `crates/rust-core/tests/parity_fixtures.rs`, `packages/core-ts/tests/parity.test.ts` | Rust and TypeScript give **identical** answers    |
| UniFFI parity       | `cargo test -p tran-uniffi` | `crates/tran-uniffi/tests/parity_fixtures.rs` + `src/lib.rs` unit tests                                                 | Native FFI surface matches the same fixture table |
| HTTP integration    | `tower::oneshot`            | `apps/api/tests/api_test.rs`                                                                                            | Routes, headers, status codes, one error envelope |
| Real socket smoke   | tokio `TcpListener`         | `apps/api/tests/server_test.rs`                                                                                         | `run_server` really serves                        |
| Client / contract   | vitest + fake `fetch`       | `packages/core-ts/tests/client.test.ts`                                                                                 | Timeouts, error mapping, Zod contract             |
| Hook / component    | vitest + Testing Library    | `apps/web/tests/{useTranApi,App}.test.tsx`                                                                              | Behaviour via roles and labels, never CSS         |
| **BDD + E2E**       | Playwright + Gherkin        | `e2e/features/vote-eligibility.feature`                                                                                 | Real browser → real Vite → real Axum (incl. CORS) |

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
pnpm test:all             # everything CI runs
pnpm check:quick          # spec check + formatting + typecheck + clippy (matches pre-commit hook)
pnpm hooks:install        # configure git core.hooksPath .githooks (runs automatically on pnpm install)
```

First E2E run needs `pnpm --filter e2e exec playwright install chromium`.

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
