# 019 - Code Health Gates

This document defines code health gates ported from the AstroFusion monorepo (S4 / T1-T3).

### REQ-CODE-001 [verified] Fake fallback gate

Production code must not contain invented default literals (`?? 0`, `|| 0` on coordinates/time, literal timezone strings, or `unwrap_or_default()` in rules core). Enforced by `tooling/fallback-gate/fallback-gate.mjs`.

### REQ-CODE-002 [verified] Touched-file coverage floor

All non-test TypeScript source files modified in a changeset must maintain 100% statement and branch coverage in the project test suite. Enforced by `tooling/touched-coverage.mjs`.

### REQ-CODE-003 [verified] Lint & debt ratchet

Counts of `as unknown as`, `eslint-disable`, and `#[allow(` must never increase relative to the recorded baseline. When occurrences are removed, the baseline auto-shrinks. Enforced by `tooling/debt/debt.mjs`.

### REQ-CODE-004 [planned] One platform floor, and no code below it

iOS MUST declare one deployment target, the previous major release (`26.0` while iOS 27 is current), and Android one
`minSdk` (`33`), with `compileSdk` and `targetSdk` at the newest stable level the stores accept. A guard MUST fail on
an availability check or version branch at or below the floor (`#available(iOS 17`, `Build.VERSION.SDK_INT >= 31`),
on a compatibility shim kept only for a version below it, and on a deprecated API that has a replacement at the floor.
Rationale: [ADR-0045](../adr/0045-latest-platforms-only.md).
**Verified by:** `packages/core-ts/tests/platform-floor.test.ts`.

### REQ-CODE-005 [planned] Code that needs real credentials ships complete, switched off, and marked

Code that cannot run without a project's own accounts (store uploads, push senders, provider sign-in, purchases) MUST
be implemented in full and disabled by the absence of its configuration, never stubbed or left out. Each test that
needs such a credential MUST exist, be skipped, and carry the marker `TODO(credentials): <VARIABLES> - <what it proves>`
as its skip reason, so that supplying the variables and deleting the skip is the whole enabling step. `pnpm todos:check`
MUST fail on a skipped, ignored or disabled test without that marker (or another stated reason on an allowlist), and on
a marker whose variables are missing from `.env.example` or from [`../CREDENTIALS.md`](../CREDENTIALS.md). The whole
test suite MUST pass with no credential set.
Rationale: [ADR-0046](../adr/0046-credential-gated-code-ships-switched-off.md).
**Verified by:** `tooling/todos/todos.test.mjs`.
