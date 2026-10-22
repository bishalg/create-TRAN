# 016 Supply chain

Scope: what keeps a known-vulnerable or tampered dependency out of this repo and out of a project scaffolded from
it: audits in CI, pinned actions, grouped update pull requests, explicit transitive fixes and a place to report.
Rationale: [ADR-0033](../adr/0033-supply-chain-defaults.md). Policy text: [`SECURITY.md`](../../SECURITY.md).

### REQ-SUP-001 [verified] Known vulnerabilities fail CI, and transitive fixes expire

CI MUST run `pnpm audit` at `high` severity and above and `cargo audit` with warnings denied, on every push and pull
request, and MUST fail on a finding. A fix for a transitive dependency the upstream package has not bumped MUST be an
override in `pnpm-workspace.yaml` keyed by the vulnerable range (`name@<fixed`), never by the bare name, so the
override stops applying once the dependant moves on. An ignored Rust advisory in `.cargo/audit.toml` MUST carry its
reason in a comment above it. `pnpm supply:check` MUST fail on a bare-name override or an unexplained ignore.
**Verified by:** `tooling/supply-chain/supply-chain.test.mjs`; the audit steps in `.github/workflows/ci.yml`.

### REQ-SUP-002 [verified] Dependabot covers every ecosystem the repo has

`.github/dependabot.yml` MUST name an update for every package ecosystem present (npm, cargo, GitHub Actions, and
gradle while `apps/android` exists), grouped so minor and patch bumps arrive as one pull request per ecosystem per
week. `pnpm supply:check` MUST fail when an ecosystem is missing.
**Verified by:** `tooling/supply-chain/supply-chain.test.mjs`.

### REQ-SUP-003 [verified] Every GitHub Action is pinned to a commit

Every `uses:` in every workflow MUST reference a 40-character commit SHA with the version as a trailing comment, so a
re-tagged release cannot change what CI runs and Dependabot can still bump it. `pnpm supply:check` MUST fail on a tag
or branch reference.
**Verified by:** `tooling/supply-chain/supply-chain.test.mjs`.

### REQ-SUP-004 [verified] A reporting path exists

`SECURITY.md` MUST say how to report a vulnerability privately, what CI enforces, and which versions receive fixes.
`pnpm supply:check` MUST fail when the reporting or supported-versions section is missing.
**Verified by:** `tooling/supply-chain/supply-chain.test.mjs`.
