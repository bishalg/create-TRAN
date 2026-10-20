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
- New user-visible behaviour needs a Gherkin scenario in `e2e/features/`.
- Native apps: `pnpm ios:build` (XcodeGen; regenerate with `pnpm ios:project`) and `pnpm android:build` stay part of the loop when touching `apps/ios` or `apps/android`.
- Before finishing: `pnpm test:all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all`.

## Workflow: spec first

1. Find or add the requirement in `docs/specs/` (`REQ-<AREA>-NNN`, `[planned]` until tested).
2. Record non-obvious decisions as an ADR in `docs/adr/`.
3. Write the failing test and cite the ID (`// Verifies: REQ-…` or in the test title / Gherkin comment).
4. Implement, then flip the status to `[verified]`.
5. Run `pnpm spec:check` plus `pnpm test:coverage` before committing.

Never mark a requirement `verified` without a test that cites it.
