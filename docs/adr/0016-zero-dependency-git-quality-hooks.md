# 16. Zero-Dependency Git Quality Hooks

Date: 2026-10-18

## Status

Accepted

## Context

In a polyglot monorepo containing Rust (Core & Axum API), TypeScript (Web, Packages, CLI), and Native Mobile (SwiftUI, Jetpack Compose), developer feedback loops must be immediate:

1. Code pushed to branches or submitted in PRs must not break format checks, type checks, or clippy lints.
2. Commits should not take minutes to complete; pre-commit checks must be fast (< 5s).
3. Monorepo templates often introduce heavy hook orchestrators (e.g., Husky, Lefthook, simple-git-hooks) which introduce extra node dependency bloat or binary downloads.

## Decision

We use Git's built-in `core.hooksPath` feature pointing directly to `.githooks/` in the workspace root:

- `.githooks/pre-commit`: Runs fast quality checks before allowing a commit:
  - `pnpm spec:check` (traceability check)
  - `cargo fmt --all -- --check` & `pnpm format:check` (formatting)
  - `pnpm typecheck` (TypeScript typing across all packages)
  - `cargo clippy --workspace --all-targets -- -D warnings` (Rust lints)
- `.githooks/pre-push`: Runs full unit test suites (`pnpm test:rust` and `pnpm test:ts`) before pushing to any remote branch.
- Automated registration: The root `package.json` configures `"prepare": "git config core.hooksPath .githooks 2>/dev/null || true"` and `"hooks:install": "git config core.hooksPath .githooks"`.

## Consequences

- Zero runtime or devDependency overhead: No external hook runner packages needed.
- Instant polyglot validation: Guards both Rust and TypeScript boundaries seamlessly.
- Non-intrusive: Standard git flags like `--no-verify` continue to work when an engineer intentionally needs to bypass local checks.
