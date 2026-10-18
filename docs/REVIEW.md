# create-TRAN — External Architecture Review (Synthesized)

**Review date:** October 2026  
**Repo snapshot:** `dev` @ `b2c9867`  
**Overall score (reviewer):** ~6/10 — strong **R** + **A** + testing; **T** and **N** lag marketing.

This page records an independent review of the TRAN template, **verified against the codebase**, corrections where the review predates recent CI work, and agreed priorities.

---

## Executive summary

create-TRAN is a credible **hello-world monorepo** for shared business rules (Rust), an Axum API, a Vite web demo, and an Expo native sketch. The **domain layer, HTTP handlers, fixture-driven parity, and test pyramid** are template-quality (~8/10 for Rust, API, and testing discipline).

The main gap is **honesty at the stack boundary**: the web app is not TanStack Start (no SSR, routing, or server functions in source), and the native app is under-scaffolded (missing assets, non-standard entry, no CI smoke). Marketing strings in `/api/tran/info`, health reports, and README still describe capabilities the code does not implement.

**Agreed direction:** fix truth-in-labeling first (real TanStack Start or rename), then make native bootable with CI smoke, then harden the Rust↔TypeScript contract and production-safe header handling.

---

## Verified findings

| Claim | Verdict | Evidence |
| :--- | :---: | :--- |
| TanStack Start not used in `apps/web` | **Yes** | `apps/web/package.json` lists `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/router-plugin`; **no imports** under `apps/web/src`. Entry is `main.tsx` + `vite.config.ts` (`@vitejs/plugin-react` only) — plain Vite SPA. |
| Docs/API advertise SSR, Router, Streaming | **Yes** | `apps/api/src/routes/tran.rs` layer `"T"` string; `docs/API.md` matches. |
| Native `assets/` missing | **Yes** | `app.json` references `./assets/icon.png`, `splash.png`, `adaptive-icon.png`; **`apps/native/assets` does not exist** (verified on disk). |
| Native entry is `src/App.tsx` without `registerRootComponent` | **Yes** | `apps/native/package.json` `"main": "src/App.tsx"`; `App.tsx` exports default component only — no `expo` entry / `registerRootComponent` in app source. Boot failure not executed in verification; **expectation aligns with Expo defaults** (`expo/AppEntry.js` pattern). |
| React / Expo version skew vs web | **Yes** | Web: React **19** (`apps/web/package.json`). Native: **Expo ~52**, **RN 0.76.7**, **React 18.3.1** (`apps/native/package.json`). |
| Audit noise from native tree | **Partial** | `pnpm audit --filter native` reports **51** vulnerabilities (3 critical) at verification time — same *class* of issue as review; exact count differs from reviewer’s 37. |
| oRPC not served from Axum | **Yes** | `packages/api/src/contract.ts` documents intentional omission; `client.ts` uses REST + Zod. No oRPC server in `apps/api`. |
| Zod vs Rust maintained separately | **Yes** | Rust structs in `crates/rust-core`; Zod in `packages/api`. `packages/api/tests/api-contract.test.ts` validates **hand-written JSON** and mocked `fetch`, not live Axum responses. Parity fixtures cover **vote rules**, not HTTP response shapes. |
| `X-Debug-Country` trusted in all environments | **Yes** | `apps/api/src/geo.rs` — debug header wins whenever non-empty; `vote.rs` passes header with no `APP_ENV` gate. Docs say “development only”; **code does not enforce**. |
| `AppConfig.environment` unused at runtime | **Yes** | Field set in `apps/api/src/config.rs`; only referenced in config unit tests — **`run_server` / routes never read it**. |
| Health endpoint always `HEALTHY`, hard-coded versions | **Yes** | `crates/rust-core/src/services/engine.rs` `generate_health_report` — all layers `healthy: true`, fixed version strings, claims web/native health server cannot observe. Handler returns engine report (`apps/api/src/routes/health.rs`). |
| Nx is thin `run-commands` wrappers | **Yes** | e.g. `apps/web/project.json` — each target runs `pnpm run …`. No `nx affected` in CI; coverage/e2e use root `pnpm` scripts directly. |
| CI E2E “never ran” | **Wrong** (stale) | GitHub Actions run [**39120412501**](https://github.com/bishalg/create-TRAN/actions/runs/39120412501) on `dev` @ `b2c9867`: Rust, TS, and **E2E + BDD (10 scenarios)** all passed. |
| CI never builds/starts native | **Yes** | `.github/workflows/ci.yml` — no native job. |
| `useTranApi` duplicated web/native | **Yes** | `apps/web/src/hooks/useTranApi.ts` vs `apps/native/src/hooks/useTranApi.ts` — same logic; env resolution differs (`import.meta.env` vs `process.env`). `fakeApi.ts` duplicated in both `tests/helpers/`. |
| Inline styling / dual styling systems | **Partial** | `App.tsx` has **26** `style={{…}}` blocks; generated `theme.css` exists alongside inline tokens — reviewer’s direction is fair. |

---

## TRAN letter grades (honest)

| Letter | Layer | Grade | Notes |
| :---: | :--- | :---: | :--- |
| **T** | TanStack Start (web) | **D** | Dependency present; runtime is Vite SPA. No file routes, loaders, or SSR. |
| **R** | Rust core | **A** | Single source of truth, injectable time, validation, fixtures, tests. |
| **A** | Axum API | **B+** | Clean handlers, unified errors, good HTTP tests; geo/debug and health are template stubs. |
| **N** | Native (Expo) | **D−** | Screen/hook exist; assets and entry likely block `expo start`; no CI; old SDK vs web React 19. |

**Testing & CI (cross-cutting):** **A−** after the October 2026 push — 100% coverage gates, parity fixtures, Playwright Gherkin on real API + web. Not a substitute for mutation testing, native E2E, or TS lint.

---

## Agreed priorities (reviewer order)

1. **Make TanStack Start real** — file routes, data loading against Axum, at least one server function — **or** rename the stack and fix `/api/tran/info` and docs so they match a Vite SPA.
2. **Upgrade native and prove boot** — add `assets/`, correct Expo entry, align React where feasible, **`expo` export or start smoke in CI** (also reduces audit surface).
3. **Rust → TypeScript contract** — codegen (ts-rs, utoipa, specta) or **live contract tests** that hit Axum and validate with Zod.
4. **Production-safe headers** — honour `X-Debug-Country` only when `APP_ENV=development` (wire `AppConfig.environment`); trusted-proxy allowlist for `X-Forwarded-For`.
5. **Clean-ups** — shared `useTranApi` package, one styling approach, TS linter (Biome/ESLint), mutation testing, decide on Nx (affected + cache vs plain pnpm).

See [ROADMAP.md](./ROADMAP.md) for checkbox backlog.

---

## What we fixed since the review session (testing push)

These landed on `dev` in commits `a0283cb` → `b2c9867` and **address several “weaknesses”** the reviewer listed, but not items 1–5 above:

- **Golden fixtures** — `fixtures/vote-eligibility.json` drives Rust + TypeScript parity tests.
- **Injectable clock/config** — deterministic API and core tests (`AppConfig::from_lookup`, `evaluate_vote_eligibility_on`).
- **100% coverage gates** — `cargo llvm-cov` and Vitest coverage in CI.
- **Hook/component tests** — `useTranApi` refetch-loop regression; web `App` behaviour tests.
- **BDD E2E** — `e2e/features/vote-eligibility.feature`, Playwright, CORS/`X-Debug-Country` scenarios.
- **CI E2E job** — now **green** on GitHub (run 39120412501); reviewer’s “never ran” note is **out of date**.
- **Testing playbook** — [TESTING.md](./TESTING.md) documents the pyramid and TDD loop.

Still open from the review: TanStack Start reality, native boot + CI, contract codegen, header gating, health honesty, shared hook, TS lint, mutation testing, Nx strategy.

---

## How to use this document

- Share with contributors evaluating whether to fork TRAN as-is.
- Track progress in [ROADMAP.md](./ROADMAP.md); close items by linking PRs.
- Re-run verification after major stack changes (update the table and letter grades).
