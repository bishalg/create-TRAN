# 007 Git Quality Hooks (Pre-Commit & Pre-Push)

Automates quality enforcement locally before code is committed or pushed, preventing broken builds, format drift, and untraced specs from reaching CI.

### REQ-HOOK-001 [verified] Fast pre-commit quality gate

The repository MUST provide a `.githooks/pre-commit` hook that executes fast local verification:

1. Requirement traceability verification (`pnpm run spec:check`).
2. Code formatting verification (`cargo fmt --all -- --check` and `pnpm run format:check`).
3. TypeScript static typechecking (`pnpm run typecheck`).
4. Rust workspace linting (`cargo clippy --workspace --all-targets -- -D warnings`).
   If any check fails, the commit MUST be aborted with a non-zero exit code.
   **Verified by:** unit test `packages/create-tran/tests/hooks.test.ts` (`[REQ-HOOK-001]`).

### REQ-HOOK-002 [verified] Pre-push unit testing gate

The repository MUST provide a `.githooks/pre-push` hook that executes the workspace unit and parity test suites (`pnpm test`, comprising `cargo test` and `vitest run`). If any test fails, the push MUST be aborted with a non-zero exit code.
**Verified by:** unit test `packages/create-tran/tests/hooks.test.ts` (`[REQ-HOOK-002]`).

### REQ-HOOK-003 [verified] Zero-dependency git hooks installation

The repository MUST manage git hooks using Git's native `core.hooksPath` pointing to `.githooks`, requiring zero external npm wrapper packages. Hook configuration MUST be automated via `pnpm prepare` and explicitly available via `pnpm run hooks:install`.
**Verified by:** unit test `packages/create-tran/tests/hooks.test.ts` (`[REQ-HOOK-003]`).
