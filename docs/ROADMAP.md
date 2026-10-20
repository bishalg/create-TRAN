# create-TRAN — Roadmap

Actionable backlog aligned with the [external architecture review](./REVIEW.md) (priorities 1–5). Check items off in PRs; keep scope one theme per PR where possible.

---

## 0. Native mobile (Swift + Kotlin) — **N** in TRAN

Platform-native iOS (`apps/ios`) and Android (`apps/android`) are the real **N**. The former Expo/RN sketch was removed (tag `archive/react-native-demo`).

- [x] Document **N** = SwiftUI + Compose (not React Native as the stack definition).
- [x] Scaffold `apps/ios` and `apps/android` with placeholder screens + `pnpm tokens:sync` → Swift/Kotlin `BrandTokens`.
- [x] Voting parity on native: offline rules via `crates/tran-uniffi` + fixture parity tests (`94f2e3b`).
- [x] Native HTTP client matching `@tran/api` (`TranApiClient` on URLSession / OkHttp; thin confirmation client with stubbed transport tests — REQ-NAT-011, [ADR-0023](./adr/0023-native-api-clients.md)).
- [x] Xcode / Gradle CI smoke (build only — no device farm required) — `ios-smoke` + `android-smoke` jobs.
- [x] Remove `apps/native` (done; see section 2).

---

## 1. TanStack Start — real or rename

- [ ] **Decision:** adopt TanStack Start for `apps/web` _or_ rebrand stack/docs as “Vite + React” (drop “Start” claims).
- [ ] If Start: add file-based routes, SSR entry, and at least one loader/server function calling Axum.
- [ ] If rename: remove unused `@tanstack/react-start` / router deps or use router without SSR claims.
- [x] Update `apps/api/src/routes/tran.rs`, `docs/API.md`, README to describe Vite SPA honestly (docs pass).
- [ ] Align root `package.json` / CLI banner / health metadata with the same **T** story.
- [ ] Add one E2E scenario that would fail if SSR/routing claims regress (e.g. deep link or server-rendered marker).

---

## 2. Legacy Expo (`apps/native`) — sunset

- [x] Removed. The React Native sketch is preserved at the git tag `archive/react-native-demo`
      (`git checkout archive/react-native-demo`); "N" means `apps/ios` + `apps/android` only.

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
