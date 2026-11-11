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
- [x] Trusted proxy list for `X-Forwarded-For` (env var or config struct field) — `TRUSTED_PROXIES`, REQ-RL-003, `d6b5b04`, [RATE_LIMITING.md](./RATE_LIMITING.md).
- [x] Update `docs/API.md` to match enforced behaviour.
- [x] API tests: debug header ignored in `production`; honoured in `development`/`test`.
- [ ] E2E: optional scenario for “debug header blocked” when `APP_ENV` is not development.

---

## 5. Clean-ups (shared code, styling, tooling)

- [ ] Extract `useTranApi` (+ shared `fakeApi` test helper) into `packages/` (e.g. `@tran/react` or extend `@tran/core`).
- [x] Pick one styling approach for web (generated CSS vs inline tokens); reduce `App.tsx` inline `style={{}}` blocks — token-bound atoms only, [ATOMIC.md](./ATOMIC.md); no `style={{` remains in `apps/web/src`.
- [x] Add TypeScript linter (Biome or ESLint) to CI; extend `pnpm lint` beyond Clippy — ESLint in `apps/web` (`apps/web/eslint.config.js`), root `pnpm lint` runs `pnpm --filter web lint`, `ci.yml` runs it.
- [x] Optional: mutation testing (`cargo-mutants`, Stryker) on critical paths — `.github/workflows/mutation.yml`, `packages/core-ts/stryker.config.json` (`5e5e180` bumps Stryker).
- [ ] **Nx** (still open: `nx.json` exists and root scripts use `nx run-many`, but CI does not use `nx affected`): use `nx affected` + caching in CI, add Rust plugin, **or** remove Nx and document plain `pnpm` workflows.
- [x] **Health:** report only `rust-core` + `axum-api` with real crate versions (REQ-API-012). ~~Return minimal `{ "ok": true, "uptime_seconds": … }` or probe real dependencies; stop asserting web/native process health from Axum.~~

---

## 6. Production-readiness topics, one at a time

Phases 2 to 5 and 12 to 14 follow the store rules in [APP_REVIEW.md](./APP_REVIEW.md); phases 6 and 7 let different
app versions live side by side; phases 8 to 11 are backend operations, built before sign-in and purchases because
those need durable accounts, limits and a deploy path. Each topic is one phase: documented first, then built and tested on every platform before the next starts. The
documents are written for the next reader, human or AI, who will add code here: a spec (what must hold), an ADR (why),
and one short playbook in `docs/` (what the topic is, why it matters, the rules to follow), plus a one-line rule in
`AGENTS.md`. Keep them short: only what changes how code is written.

1. [x] **Security** ([spec 022](./specs/022-security.md), ADR-0039, [playbook](./SECURITY.md)): secrets, rotating
       sessions, Keychain and Keystore storage, sensitive data.
2. [x] **Account deletion** ([spec 024](./specs/024-account-deletion.md), ADR-0041,
       [playbook](./ACCOUNT_DELETION.md)): delete the account from inside the app (App Store guideline 5.1.1(v)) and from a public
       web page (Google Play's account-deletion policy), confirmed first, with every session revoked, the device
       vault cleared and the server data erased or scheduled for erasure.
3. [x] **Mobile release automation (fastlane)** ([spec 025](./specs/025-mobile-release.md), ADR-0042,
       [playbook](./MOBILE_RELEASE.md)): one `Fastfile` per platform with the same lanes (`test`, `beta`,
       `release`), signing kept out of the repo, store credentials only in CI secrets, versions still from
       `pnpm release` (ADR-0034).
4. [x] **Permissions and privacy prompts** ([spec 026](./specs/026-permissions-and-privacy.md), ADR-0043,
       [playbook](./PERMISSIONS.md)): ask in context with a purpose string, work when denied, optional personal
       questions (gender, birth date), no tracking without App Tracking Transparency (a guard: the template does not
       track).
5. [x] **Push notifications and device registration** ([spec 027](./specs/027-push-and-devices.md), ADR-0044,
       [playbook](./PUSH.md)): optional push, the device token registered to the signed-in
       user on the API, replaced when it changes, removed on sign-out and account deletion.
6. [x] **API versioning and compatibility** ([spec 028](./specs/028-api-versioning.md), ADR-0047,
       [playbook](./API_VERSIONING.md)): a versioned base path, additive-change rules checked against contract
       snapshots (REQ-API-011), deprecation headers, and a minimum supported client version that old apps obey. Shipped
       (`9b60346`, `bb188de`; REQ-VER-001 to 005 verified).
7. [x] **Feature flags and remote configuration** ([spec 029](./specs/029-remote-config.md), ADR-0048,
       [playbook](./REMOTE_CONFIG.md)): typed flags with safe defaults, evaluated in one place, a kill
       switch, and stale flags removed by a check. Shipped (`2972292`; spec 029 has no `[planned]` requirement).
8. [x] **Persistence and migrations** ([spec 030](./specs/030-persistence-and-migrations.md), ADR-0049,
       [playbook](./PERSISTENCE.md)): a durable `SessionStore`, forward-only schema migrations run and verified at
       start-up, and versioned client-side stored records. Shipped (`5cc25bb`, `5112791`; spec 030 has no `[planned]` requirement).
9. [x] **Rate limiting and abuse protection** ([spec 031](./specs/031-rate-limiting.md), ADR-0050,
       [playbook](./RATE_LIMITING.md)): limits per client and per route as policy data, `429` with
       `Retry-After` (the clients already honour it), tighter limits on the auth routes. Shipped (`d6b5b04`; REQ-RL-001 to 010 verified).
10. [x] **Observability** ([spec 023](./specs/023-observability.md), ADR-0040, [runbook](./OBSERVABILITY.md)): trace
        context, log schema, RED metrics, readiness and graceful shutdown. Shipped (`967d33e`; spec 023 has no `[planned]` requirement).
11. [x] **Container image and deploy pipeline** ([spec 032](./specs/032-deploy-pipeline.md), ADR-0051,
        [playbook](./DEPLOY.md)): a small reproducible image, configuration by environment, health-gated
        rollout and rollback, and release artefacts built once and promoted. Shipped (`e4cdd71`, `e523aee`); REQ-DEP-010 (image size and
        start-up budgets) is still `[planned]` in spec 032.

12. [ ] **Sign-in providers**: a provider seam with Google and Sign in with Apple, the rule that Apple is offered
        whenever a third-party provider is (guideline 4.8) as a check, the system Apple button and Google's branded
        button used as their guidelines require, identity tokens verified on the API, cancellation and provider errors
        through the error catalogue, and provider tokens revoked on deletion.
13. [ ] **In-app purchases**: StoreKit 2 and Play Billing behind one seam; a paywall that shows the localized price,
        the billing period, the renewal and cancellation terms and links to terms and privacy before the purchase
        button; restore purchases; entitlements verified and synced on the API; pending, cancelled, failed, refunded
        and already-owned outcomes each with a catalogue presentation.
14. [ ] **Onboarding**: a short first-run flow that can be skipped, leads into sign-in, and never asks for an account or
        a permission before the feature that needs it.

---

## 7. Hardening backlog

Not started; each is a candidate phase once the topics above are done.

- [ ] **Defect:** rollback after a migration. `scripts/deploy.sh --rollback` cannot redeploy the previous digest once a newer migration has run, because the older binary's migration `verify()` rejects an unknown migration (REQ-DB-002 against REQ-DEP-006); decide and fix ([RUNBOOK.md Gaps](./RUNBOOK.md#gaps)).
- [ ] Idempotency keys for mutating routes ([spec 033](./specs/033-idempotency.md), planned).
- [ ] Generated HTTP contract from Rust ([spec 034](./specs/034-http-contract.md), planned); would close section 3.
- [ ] Database backup command, schedule and restore drill ([RUNBOOK.md Gaps](./RUNBOOK.md#gaps)).
- [ ] Readiness checks the database ([RUNBOOK.md Gaps](./RUNBOOK.md#gaps)).
- [ ] Revoke all sessions (one user, or everyone) without deleting an account ([RUNBOOK.md Gaps](./RUNBOOK.md#gaps)).
- [ ] Container hardening in Compose (`cap_drop`, `no-new-privileges`), image scan and signature/provenance check at deploy ([THREAT_MODEL.md](./THREAT_MODEL.md#out-of-scope-or-not-mitigated-in-the-template)).
- [ ] The log schema lists the `detail` field the API's `request failed` event carries (REQ-OBS-002), and panic text is kept out of it ([THREAT_MODEL.md](./THREAT_MODEL.md#out-of-scope-or-not-mitigated-in-the-template)).
- [ ] Security audit log (who did what, to which account, when; no tokens or bodies).
- [ ] Personal data export (the counterpart of [account deletion](./ACCOUNT_DELETION.md)).
- [ ] Static analysis in CI (CodeQL or Semgrep).
- [ ] Licence policy (`cargo-deny`).
- [ ] Docs link check wired into `pnpm tooling:test` (checker: `tooling/doc-links/doc-links.mjs`).

---

## Done recently (reference)

- [x] Parity fixtures + 100% Rust/TS coverage gates (`a0283cb`, `b89b2c6`).
- [x] Playwright Gherkin E2E + CI job green on `dev` (`b2c9867`, [run 39120412501](https://github.com/bishalg/create-TRAN/actions/runs/39120412501)).
- [x] [TESTING.md](./TESTING.md) playbook.
- [x] Define **N** as Swift/Kotlin; scaffold `apps/ios` + `apps/android` + token codegen stubs.
- [x] Native apps compile & run: shared `BrandPalette` codegen, Gradle wrapper, XcodeGen project, simulator/emulator-verified.
