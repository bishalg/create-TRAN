# create-TRAN — Roadmap

Actionable backlog aligned with the [external architecture review](./REVIEW.md) (priorities 1–5). Check items off in PRs; keep scope one theme per PR where possible.

---

## 0. Native mobile (Swift + Kotlin) — **N** in TRAN

Platform-native iOS (`apps/ios`) and Android (`apps/android`) are the real **N**. `apps/native` (Expo/RN) is **legacy interim** only.

- [x] Document **N** = SwiftUI + Compose (not React Native as the stack definition).
- [x] Scaffold `apps/ios` and `apps/android` with placeholder screens + `pnpm tokens:sync` → Swift/Kotlin `BrandTokens`.
- [x] Voting parity on native: offline rules via `crates/tran-uniffi` + fixture parity tests (`94f2e3b`).
- [ ] Native HTTP client matching `@tran/api` (URLSession / OkHttp + Zod-equivalent validation).
- [x] Xcode / Gradle CI smoke (build only — no device farm required) — `ios-smoke` + `android-smoke` jobs.
- [ ] Migrate or remove `apps/native` after native apps match web demo features.
- [ ] Optional: keep Expo under `apps/mobile-rn` if a JS mobile sketch is still wanted post-migration.

---

## 1. TanStack Start — real or rename

- [ ] **Decision:** adopt TanStack Start for `apps/web` _or_ rebrand stack/docs as “Vite + React” (drop “Start” claims).
- [ ] If Start: add file-based routes, SSR entry, and at least one loader/server function calling Axum.
- [ ] If rename: remove unused `@tanstack/react-start` / router deps or use router without SSR claims.
- [x] Update `apps/api/src/routes/tran.rs`, `docs/API.md`, README to describe Vite SPA honestly (docs pass).
- [ ] Align root `package.json` / CLI banner / health metadata with the same **T** story.
- [ ] Add one E2E scenario that would fail if SSR/routing claims regress (e.g. deep link or server-rendered marker).

---

## 2. Legacy Expo (`apps/native`) — boot or sunset

- [ ] Add `apps/native/assets/` (`icon.png`, `splash.png`, `adaptive-icon.png`, `favicon.png`) per `app.json`.
- [ ] Fix entry: `expo/AppEntry` pattern or `index.js` with `registerRootComponent` (stop using raw `src/App.tsx` as `main` unless documented).
- [ ] Manually verify `pnpm dev:native` / `expo start` on iOS simulator or Android emulator **only if** keeping interim RN.
- [ ] Plan Expo SDK upgrade path (review cited Expo 58 / RN 0.88 / React 19 — align with web when stable).
- [ ] CI job: `expo export` or minimal `tsc` + `expo doctor` smoke on `apps/native` (optional while interim).
- [ ] Re-run `pnpm audit --filter native` after upgrade; document acceptable residual risk.

---

## 3. Rust ↔ TypeScript contract

- [ ] Spike: **ts-rs**, **utoipa** (OpenAPI), or **specta** for vote + health + tran info types.
- [ ] Generate or derive TS types/schemas from Rust (or OpenAPI from Axum).
- [ ] Add **live contract test**: spin API (tower `oneshot` or test listener), `fetch` real routes, `Zod.parse` responses.
- [ ] Keep `fixtures/vote-eligibility.json` for **business-rule** parity; do not confuse with HTTP schema parity.
- [ ] Document oRPC stance: client-side contract only until a Rust oRPC host exists.

---

## 4. Production-safe debug and proxy headers

- [ ] Wire `AppConfig.environment` into geo middleware: ignore `X-Debug-Country` unless `development` (or explicit `ALLOW_DEBUG_COUNTRY=1`).
- [ ] Trusted proxy list for `X-Forwarded-For` (env var or config struct field).
- [ ] Update `docs/API.md` and locale hints to match enforced behaviour.
- [ ] API tests: debug header ignored in `production`/`test` profile; still works in `development`.
- [ ] E2E: optional scenario for “debug header blocked” when `APP_ENV` is not development.

---

## 5. Clean-ups (shared code, styling, tooling)

- [ ] Extract `useTranApi` (+ shared `fakeApi` test helper) into `packages/` (e.g. `@tran/react` or extend `@tran/core`).
- [ ] Pick one styling approach for web (generated CSS vs inline tokens); reduce `App.tsx` inline `style={{}}` blocks.
- [ ] Add TypeScript linter (Biome or ESLint) to CI; extend `pnpm lint` beyond Clippy.
- [ ] Optional: mutation testing (`cargo-mutants`, Stryker) on critical paths.
- [ ] **Nx:** use `nx affected` + caching in CI, add Rust plugin, **or** remove Nx and document plain `pnpm` workflows.
- [ ] **Health:** return minimal `{ "ok": true, "uptime_seconds": … }` or probe real dependencies; stop asserting web/native process health from Axum.

---

## Done recently (reference)

- [x] Parity fixtures + 100% Rust/TS coverage gates (`a0283cb`, `b89b2c6`).
- [x] Playwright Gherkin E2E + CI job green on `dev` (`b2c9867`, [run 39120412501](https://github.com/bishalg/create-TRAN/actions/runs/39120412501)).
- [x] [TESTING.md](./TESTING.md) playbook.
- [x] Define **N** as Swift/Kotlin; scaffold `apps/ios` + `apps/android` + token codegen stubs.
- [x] Native apps compile & run: shared `BrandPalette` codegen, Gradle wrapper, XcodeGen project, simulator/emulator-verified.
