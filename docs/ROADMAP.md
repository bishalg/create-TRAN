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
- [x] Remove unused `@tanstack/react-start` / router deps until Start is actually adopted; ADR-0010 is `proposed`.
- [x] Update `apps/api/src/routes/tran.rs`, `docs/API.md`, README to describe Vite SPA honestly (docs pass).
- [x] Align root `package.json` / CLI banner / health metadata with the same **T** story.
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

- [x] Wire `AppConfig.environment` into the eligibility handler: ignore `X-Debug-Country` unless `development` or `test` (REQ-API-006).
- [ ] Trusted proxy list for `X-Forwarded-For` (env var or config struct field).
- [x] Update `docs/API.md` to match enforced behaviour.
- [x] API tests: debug header ignored in `production`; honoured in `development`/`test`.
- [ ] E2E: optional scenario for “debug header blocked” when `APP_ENV` is not development.

---

## 5. Clean-ups (shared code, styling, tooling)

- [ ] Extract `useTranApi` (+ shared `fakeApi` test helper) into `packages/` (e.g. `@tran/react` or extend `@tran/core`).
- [ ] Pick one styling approach for web (generated CSS vs inline tokens); reduce `App.tsx` inline `style={{}}` blocks.
- [ ] Add TypeScript linter (Biome or ESLint) to CI; extend `pnpm lint` beyond Clippy.
- [ ] Optional: mutation testing (`cargo-mutants`, Stryker) on critical paths.
- [ ] **Nx:** use `nx affected` + caching in CI, add Rust plugin, **or** remove Nx and document plain `pnpm` workflows.
- [x] **Health:** report only `rust-core` + `axum-api` with real crate versions (REQ-API-012). ~~Return minimal `{ "ok": true, "uptime_seconds": … }` or probe real dependencies; stop asserting web/native process health from Axum.~~

---

## 6. Production-readiness topics, one at a time

Phases 2 to 8 follow the store rules in [APP_REVIEW.md](./APP_REVIEW.md); phases 9 to 14 are backend
operations. Each topic is one phase: documented first, then built and tested on every platform before the next starts. The
documents are written for the next reader, human or AI, who will add code here: a spec (what must hold), an ADR (why),
and one short playbook in `docs/` (what the topic is, why it matters, the rules to follow), plus a one-line rule in
`AGENTS.md`. Keep them short: only what changes how code is written.

1. [x] **Security** ([spec 022](./specs/022-security.md), ADR-0039, [playbook](./SECURITY.md)): secrets, rotating
       sessions, Keychain and Keystore storage, sensitive data.
2. [ ] **Account deletion** ([spec 024](./specs/024-account-deletion.md), ADR-0041,
       [playbook](./ACCOUNT_DELETION.md)): delete the account from inside the app (App Store guideline 5.1.1(v)) and from a public
       web page (Google Play's account-deletion policy), confirmed first, with every session revoked, the device
       vault cleared and the server data erased or scheduled for erasure.
3. [ ] **Mobile release automation (fastlane)** ([spec 025](./specs/025-mobile-release.md), ADR-0042,
       [playbook](./MOBILE_RELEASE.md)): one `Fastfile` per platform with the same lanes (`test`, `beta`,
       `release`), signing kept out of the repo, store credentials only in CI secrets, versions still from
       `pnpm release` (ADR-0034).
4. [ ] **Permissions and privacy prompts**: ask in context with a purpose string, work when denied, optional personal
       questions (gender, birth date), no tracking without App Tracking Transparency (a guard: the template does not
       track).
5. [ ] **Push notifications and device registration**: optional push, the device token registered to the signed-in
       user on the API, replaced when it changes, removed on sign-out and account deletion.
6. [ ] **Sign-in providers**: a provider seam with Google and Sign in with Apple, the rule that Apple is offered
       whenever a third-party provider is (guideline 4.8) as a check, and provider tokens revoked on deletion.
7. [ ] **In-app purchases**: StoreKit 2 and Play Billing behind one seam, server-verified entitlements, restore
       purchases, terms shown before purchase.
8. [ ] **Onboarding**: a short first-run flow that can be skipped and never asks for an account or a permission before
       the feature that needs it.
9. [ ] **Observability** ([spec 023](./specs/023-observability.md), ADR-0040, [runbook](./OBSERVABILITY.md)): trace
       context, log schema, RED metrics, readiness and graceful shutdown.
10. [ ] **API versioning and compatibility**: a versioned base path, additive-change rules checked against contract
        snapshots (REQ-API-011), deprecation headers, and a minimum supported client version that old apps obey.
11. [ ] **Persistence and migrations**: a durable `SessionStore`, forward-only schema migrations run and verified at
        start-up, and versioned client-side stored records.
12. [ ] **Rate limiting and abuse protection**: limits per client and per route as policy data, `429` with
        `Retry-After` (the clients already honour it), tighter limits on the auth routes.
13. [ ] **Feature flags and remote configuration**: typed flags with safe defaults, evaluated in one place, a kill
        switch, and stale flags removed by a check.
14. [ ] **Container image and deploy pipeline**: a small reproducible image, configuration by environment, health-gated
        rollout and rollback, and release artefacts built once and promoted.

---

## Done recently (reference)

- [x] Parity fixtures + 100% Rust/TS coverage gates (`a0283cb`, `b89b2c6`).
- [x] Playwright Gherkin E2E + CI job green on `dev` (`b2c9867`, [run 39120412501](https://github.com/bishalg/create-TRAN/actions/runs/39120412501)).
- [x] [TESTING.md](./TESTING.md) playbook.
- [x] Define **N** as Swift/Kotlin; scaffold `apps/ios` + `apps/android` + token codegen stubs.
- [x] Native apps compile & run: shared `BrandPalette` codegen, Gradle wrapper, XcodeGen project, simulator/emulator-verified.
