# Guidance for AI agents working in this repo

This is a **template**: keep the sample tiny, exemplary and fully tested.

- Read [docs/TESTING.md](docs/TESTING.md) first. Work test-first (red → green → refactor).
- Business rules live in `crates/rust-core`. Rule **data** (tables, limits, messages) reaches TypeScript only via
  `pnpm tokens:sync` → `packages/core-ts/src/generated/rules.ts` (ADR-0027) — never hand-copy it. The few TS functions
  over that data are pinned by fixtures. Native offline
  voting uses `crates/tran-uniffi` (`pnpm uniffi:generate` after export changes). Change
  `fixtures/vote-eligibility.json` first; Rust, TypeScript, and UniFFI parity tests consume it.
- Coverage is a gate: 100% for Rust (`pnpm test:rust:coverage`) and sample TypeScript
  (`pnpm test:ts:coverage`). Do not lower thresholds or add excludes without a reason in `vitest.config.ts`.
- **N** in TRAN means **iOS (SwiftUI)** and **Android (Compose)** under `apps/ios` and `apps/android`, not React Native. The old React Native sketch was removed; retrieve it with `git checkout archive/react-native-demo`.
- Design tokens: edit `crates/rust-core/src/tokens.rs`, then `pnpm tokens:sync` (TS, CSS, Swift, Kotlin, root `DESIGN.md` for agents/Stitch). Destinations live in `tooling/design-tokens/codegen.json`; keep the binary in this monorepo (ADR-0025). Pipeline playbook: `docs/DESIGN.md`; do not hand-edit generated `DESIGN.md` (ADR-0026). `cargo test`
  fails while any generated file is stale (ADR-0030).
- Web UI: token-bound atoms in `apps/web/src/shared/ui/` only (no inline `style` / raw semantic tags in features; see [docs/ATOMIC.md](docs/ATOMIC.md)).
- New cross-platform screen behaviour starts as a scenario in `crates/rust-core/src/screens/scenarios.rs`
  (`pnpm tokens:sync` renders it to `e2e/features/screens/`, never edit those); web-only behaviour still gets a
  hand-written Gherkin scenario in `e2e/features/` (ADR-0038).
- UI changes: `pnpm visual` / `pnpm android:screenshots` / `pnpm ios:screenshots` (references are local and gitignored — never commit images). A change that may move performance or size: `pnpm metrics`, and `--record` to commit the numbers in `docs/reports/` (ADR-0031). Never hand-edit `docs/reports/`. Release builds: `pnpm smoke`.
- Native apps: `pnpm ios:build` (XcodeGen; regenerate with `pnpm ios:project`) and `pnpm android:build` stay part of the loop when touching `apps/ios` or `apps/android`.
- Dependencies: fix an advisory by the smallest bump; if upstream has not bumped, add a ranged override
  (`name@<fixed`) in `pnpm-workspace.yaml`, never a bare name. Every GitHub Action stays pinned to a commit SHA with a
  version comment (`pnpm supply:check`, ADR-0033).
- Security ([docs/SECURITY.md](docs/SECURITY.md), spec 022): a client binary has no secrets; a credential is stored
  only through the platform `SessionVault` (never Web Storage, `UserDefaults` or plain preferences); a new environment
  variable goes in `.env.example`; never log a header, a token or a body (`pnpm secrets:check`).
- Accounts ([docs/ACCOUNT_DELETION.md](docs/ACCOUNT_DELETION.md), spec 024): deletion is in the app and on a public
  page, has its own confirmation, and clears the device only after the server answers `204`.
- Mobile releases ([docs/MOBILE_RELEASE.md](docs/MOBILE_RELEASE.md), spec 025): identifiers and signing credentials
  come only from the environment (placeholders in the repo, listed in `.env.example`); lanes never bump a version and
  `release` never rebuilds; a new iOS required-reason API goes in `PrivacyInfo.xcprivacy`.
- Store rules ([docs/APP_REVIEW.md](docs/APP_REVIEW.md)): before adding a permission, a sign-in provider, a purchase
  or a personal question, find its row there; add the row if it is missing.
- No third-party product SDKs (purchases, sign-in, analytics, push, crash reporting): build on the platform APIs behind
  a seam and learn the pattern from the best SDK instead of importing it, so the template shows how the thing works. A
  fork may swap an SDK in behind the seam. Record an unavoidable exception in an ADR.
- Permissions ([docs/PERMISSIONS.md](docs/PERMISSIONS.md), spec 026): a permission is a catalogue entry in
  `crates/rust-core`, asked only from the control that needs it, after priming, through the platform gateway; refusal
  is a fallback, never an error; personal questions are optional; no tracking code.
- Push ([docs/PUSH.md](docs/PUSH.md), spec 027): a registration is bound to a session and removed by the server when
  the session ends; one token, one user; a payload carries no personal data; never log a token or an installation id.
- Latest platforms only (ADR-0045): iOS deployment target is the previous major release, Android `minSdk` is 33; no
  availability checks, version branches or shims below the floor, and no deprecated API that has a replacement.
- Needs real credentials ([docs/CREDENTIALS.md](docs/CREDENTIALS.md), ADR-0046): implement it fully, switch it off by
  missing configuration, and skip its tests with `TODO(credentials): <VARIABLES> - <what it proves>`. The suite passes
  with nothing configured; never fake a credential to make a test pass.
- API changes ([docs/API_VERSIONING.md](docs/API_VERSIONING.md), spec 028): add, never change, inside `/api/v1`; a
  breaking change is a new version path; clients ignore unknown fields and fall back on unknown enum values.
- Flags ([docs/REMOTE_CONFIG.md](docs/REMOTE_CONFIG.md), spec 029): declare a flag in `crates/rust-core` with a safe
  default and an expiry; a new feature ships with its flag off; never wait for config; a flag is not a lock.
- Database ([docs/PERSISTENCE.md](docs/PERSISTENCE.md), spec 030): one SQL store implementation, no fakes of it;
  migrations are forward-only and never edited once shipped; expand, then contract; migrate, then serve.
- Limits ([docs/RATE_LIMITING.md](docs/RATE_LIMITING.md), spec 031): every route names its class in the route table;
  the key is the user or a trusted-proxy address, never a raw header; `429` always carries `Retry-After`.
- Deploy ([docs/DEPLOY.md](docs/DEPLOY.md), spec 032): build the image once and promote it by digest; nothing
  environment-specific in the image; check config, migrate, start, wait for ready, then drain the old.
- Hand-written code and test files stay at or under 800 lines (`pnpm tooling:test`): split by responsibility, not
  by line count. Generated files are exempt; docs have no hard limit but are split by topic.
- Commits are Conventional Commits (`feat(scope): …`, `fix!: …`; the `commit-msg` hook checks). One version for every
  package and platform: never hand-edit a version or build number, use `pnpm release` (ADR-0034).
- Before finishing: `pnpm test:all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all`.

## Workflow: spec first

1. Find or add the requirement in `docs/specs/` (`REQ-<AREA>-NNN`, `[planned]` until tested).
2. Record non-obvious decisions as an ADR in `docs/adr/`.
3. Write the failing test and cite the ID (`// Verifies: REQ-…` or in the test title / Gherkin comment).
4. Implement, then flip the status to `[verified]`.
5. Run `pnpm spec:check` plus `pnpm test:coverage` before committing.

Never mark a requirement `verified` without a test that cites it.

## Unattended agents

Scheduled and micro-task agents (Jules, Claude Code, Codex, Gemini CLI, pi or any harness) run the task files in
[`.agents/tasks/`](.agents/tasks/) through `pnpm agents run <task> --harness <name>`; setup in
[`.agents/README.md`](.agents/README.md), rationale in ADR-0032.

- No signal, no change: work only from the evidence a task's signal produced. Making no change is a correct outcome.
- Never weaken a test, threshold, budget or gate; never edit `.agents/`, CI or dependency manifests unless the task
  allows it. The runner's guard enforces this.
- The repo is the system of record: write decisions to files (specs, ADRs, `docs/LEARNINGS.md`), never only in chat.
- Read [`docs/LEARNINGS.md`](docs/LEARNINGS.md) before starting. Add an entry only for a lesson that changes how the
  next person or agent works here.
