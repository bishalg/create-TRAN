# 009 Native tests in CI

Scope: `.github/workflows/native-tests.yml` — the iOS (`pnpm ios:test`) and Android (`pnpm android:test`) suites, which are too
slow and simulator-dependent for the pull-request gate. Rationale: [ADR-0021](../adr/0021-native-tests-in-ci.md). Local loop:
[docs/TESTING.md](../TESTING.md).

### REQ-CI-001 [verified] Native suites gate on a schedule, not on every pull request

The native suites MUST run on a nightly schedule and on manual dispatch — with SHA-pinned actions, a timeout and
failure artifacts on every job — and MUST NOT become pull-request checks before the promotion rule is met. A failing
nightly run MUST open or update a single tracking issue, and a green nightly run MUST close it. Maestro smoke flows
MUST stay dispatch-only.
**Verified by:** the workflow contract test
([`native-tests-workflow.test.ts`](../../apps/web/tests/native-tests-workflow.test.ts)) and the first green
`workflow_dispatch` run on `dev`:
[39291002585](https://github.com/bishalg/create-TRAN/actions/runs/39291002585). The promotion rule (**14 consecutive
green nightly runs**) and the dispatch commands live in [docs/TESTING.md](../TESTING.md).
