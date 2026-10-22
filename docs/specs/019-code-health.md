# 019 - Code Health Gates

This document defines code health gates ported from the AstroFusion monorepo (S4 / T1-T3).

### REQ-CODE-001 [verified] Fake fallback gate

Production code must not contain invented default literals (`?? 0`, `|| 0` on coordinates/time, literal timezone strings, or `unwrap_or_default()` in rules core). Enforced by `tooling/fallback-gate/fallback-gate.mjs`.

### REQ-CODE-002 [verified] Touched-file coverage floor

All non-test TypeScript source files modified in a changeset must maintain 100% statement and branch coverage in the project test suite. Enforced by `tooling/touched-coverage.mjs`.

### REQ-CODE-003 [verified] Lint & debt ratchet

Counts of `as unknown as`, `eslint-disable`, and `#[allow(` must never increase relative to the recorded baseline. When occurrences are removed, the baseline auto-shrinks. Enforced by `tooling/debt/debt.mjs`.
