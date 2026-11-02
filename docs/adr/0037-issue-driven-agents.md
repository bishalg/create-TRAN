# ADR-0037 Issue-driven agents on GitHub Actions, with the issue as the state

Status: proposed

## Context

Hosted agents such as Jules took a GitHub issue, planned, implemented in a VM, opened a pull request and reviewed
code. That service is being withdrawn, and the workflow it enabled (validate every issue, push back on weak ones,
implement the simple ones, label the rest for a person) is worth keeping without a vendor. Spec 015 already gives
this repo a harness-neutral runner, a guard and gates for scheduled work; it has no notion of a task that starts from
an issue, a human approval step, or triage labels.

Alternatives considered: a separate service with its own database and UI (more to run, slower to ship); the
vendor's GitHub action alone (no guard, no gates run outside the model, one harness); self-hosted VMs (a security and
patching surface we do not need yet).

## Decision

Extend the runner with an `issue` trigger (spec 020). GitHub Actions is the compute: each run is an ephemeral job.
The issue is the only state: triage labels are the state machine, comments the log, one pull request the result.
Human control is two comments, a plan and `/approve`, gated on write access. Credentials are secrets only: an API key
or a `claude setup-token` token for Claude Code, a fine-grained or App token for GitHub. Everything repo-specific
stays in `AGENTS.md`, `.agents/policy.json`, task files and the issue template, so the same runner serves any
repository created from this template or adopting `.agents/` by copy.

## Consequences

- No new infrastructure; cost is Actions minutes plus model usage, both visible on the pull request.
- Steering happens at stage boundaries (gate, plan, implement, review), not mid-run.
- Jobs are capped at six hours; a large issue is split into issues, not run longer.
- No cross-repository view; a dashboard would be an additive later ADR.
- Enforced by `pnpm agents:check` (task files with `trigger: issue`), unit tests with a fake GitHub client, and the
  existing guard job on every `agent/` pull request.
