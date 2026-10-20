# Contributing to create-TRAN

Thanks for improving the TRAN template. This repo follows conventions inspired by [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo).

## Monorepo layout

| Path                   | Role                                                        |
| :--------------------- | :---------------------------------------------------------- |
| `apps/web`             | Vite + React SPA (TanStack Start planned, ADR-0010)         |
| `apps/ios`             | SwiftUI iOS client (**N** in TRAN)                          |
| `apps/android`         | Jetpack Compose Android client (**N** in TRAN)              |
| `apps/api`             | Axum HTTP API (Rust)                                        |
| `crates/rust-core`     | Domain rules + design tokens (source of truth)              |
| `crates/tran-uniffi`   | UniFFI exports for iOS/Android offline voting               |
| `packages/core-ts`     | Shared TS SDK, tokens, i18n, offline rule mirror            |
| `packages/api`         | oRPC contract + Zod schemas + typed client                  |
| `packages/create-tran` | Scaffolding CLI                                             |
| `tooling/typescript`   | Shared `tsconfig` bases                                     |
| `e2e`                  | Playwright + Gherkin (BDD) against the real API and web app |
| `fixtures`             | Golden cases shared by Rust and TypeScript tests            |

## Development

```bash
pnpm install
pnpm dev:api    # Axum on :3001
pnpm dev:web
pnpm test       # cargo test + vitest
pnpm test:all   # coverage gates + E2E (CI)
pnpm typecheck
pnpm tokens:sync
pnpm uniffi:generate   # after changing tran-uniffi exports
```

Work test-first; the full playbook is in [docs/TESTING.md](./docs/TESTING.md). Coverage is gated at 100% (`pnpm test:coverage`) and user-visible behaviour needs a Gherkin scenario in `e2e/features/` (`pnpm test:e2e`). Change `fixtures/vote-eligibility.json` first for rule changes — Rust, TypeScript, and UniFFI parity tests consume it.

TypeScript offline rules in `packages/core-ts/src/voting.ts` must stay aligned with `crates/rust-core/src/voting.rs`; the shared `fixtures/vote-eligibility.json` enforces it.

## Gitflow & Pull requests

We follow **Gitflow branching**:

- **Base integration branch**: All active work is branched from and PRed into **`dev`**. `main` is reserved for tagged production releases.
- **Feature branches**: Create descriptive branches off `dev`:
  ```bash
  git checkout dev && git pull origin dev
  git checkout -b feat/your-feature-name
  ```
- **Automated Quality Hooks**:
  - `pnpm install` automatically activates our Git native quality hooks (`core.hooksPath .githooks`).
  - **`pre-commit`** executes fast local checks: requirement traceability (`pnpm spec:check`), code formatting (`cargo fmt`, `prettier`), TypeScript typing (`pnpm typecheck`), and Rust linting (`cargo clippy`).
  - **`pre-push`** executes full workspace unit and parity test suites (`pnpm test`) before allowing a push to any remote branch.
  - Run `pnpm check:quick` at any time to verify local quality gates in seconds.
- **Pull Request Checklist**:
  - Keep files focused (strictly ≤ 800 lines per file).
  - Open PR targeting the **`dev`** branch.
  - Ensure all CI checks and local pre-commit/pre-push gates pass.
  - Native changes: verify `pnpm ios:build` and/or `pnpm android:build`.
  - Update documentation and specs (`docs/specs/`, `docs/adr/`) for any architectural or domain changes.

## License

MIT — see [LICENSE](./LICENSE).
