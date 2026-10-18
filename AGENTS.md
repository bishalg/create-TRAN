# Guidance for AI agents working in this repo

This is a **template**: keep the sample tiny, exemplary and fully tested.

- Read [docs/TESTING.md](docs/TESTING.md) first. Work test-first (red → green → refactor).
- Business rules live in `crates/rust-core` and are mirrored in `packages/core-ts`. Change
  `fixtures/vote-eligibility.json` first; both test suites consume it.
- Coverage is a gate: 100% for Rust (`pnpm test:rust:coverage`) and sample TypeScript
  (`pnpm test:ts:coverage`). Do not lower thresholds or add excludes without a reason in `vitest.config.ts`.
- **N** in TRAN means **iOS (SwiftUI)** and **Android (Compose)** under `apps/ios` and `apps/android`, not React Native. `apps/native` is legacy interim.
- Design tokens: edit `crates/rust-core/src/tokens.rs`, then `pnpm tokens:sync` (TS, CSS, Swift, Kotlin).
- New user-visible behaviour needs a Gherkin scenario in `e2e/features/`.
- Native apps: `pnpm ios:build` (XcodeGen; regenerate with `pnpm ios:project`) and `pnpm android:build` stay part of the loop when touching `apps/ios` or `apps/android`.
- Before finishing: `pnpm test:all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all`.
