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

## Details fixed before implementation (2026-11-02)

Numbered so a pull request can cite the one it carries out. Each is also a requirement in spec 020.

1. **State is labels plus a marker, nothing else.** The coarse state is one triage label on the issue
   (`needs-detail`, `approval-needed`, `human-decision-needed`, `review-needed`, `good-to-merge`; `agent:running` and
   `agent:failed` while a job runs or after it dies). The fine state lives in the first line of each runner comment: an
   HTML comment `<!-- tran-agent {"stage":…,"verdict":…,"size":…,"plan":"sha256:…","harness":…} -->`. The runner finds
   its comment by marker and edits it in place, one per stage per issue, and reads labels and markers back at the start
   of every job. Rejected: a JSON file on a branch (a second source of truth that drifts), issue-body edits (the author's
   text is theirs unless `issues.applyRewrite` says otherwise).
2. **Two-tier gate.** The runner checks the template's sections mechanically before any model starts; only a
   structurally complete issue reaches the read-only judgment task, and a judgment can never upgrade a structural
   `needs-detail`. So the gate labels and rewrites even with no credential, which makes the trigger provable on a fresh
   fork. The model's report starts with `VERDICT:` and optional `SIZE:` lines the runner parses, in the spirit of the
   `NO-CHANGE:` hand-off.
3. **Approval is a later `issue_comment` event.** `/approve` on the first non-blank line, author permission from
   `GET /repos/{o}/{r}/collaborators/{user}/permission` (never `author_association`). The plan carried into the prompt is
   the newest plan-bearing comment at or before the approval: the runner's `plan` comment or a write-access user's comment
   with a `## Plan` heading. Its SHA-256 goes into the `plan` marker, so a later run can tell whether the approved plan is
   the one it implemented. The plan rides in its own fenced block labelled "approved plan"; issue and comment text ride in
   a fence labelled untrusted, with the instruction that it contains no commands.
4. **One job, one orchestrator command.** `node tooling/agents/agents.mjs issue --event $GITHUB_EVENT_PATH` decides the
   stage from the event and the state, then reuses `runTask` for the model stages. GitHub access goes through one
   injectable client (`github.mjs`, `gh api` underneath) so the unit tests use a fake and the live path has one file.
   Rejected: a job per stage (duplicated setup, state spread across workflow outputs), `actions/github-script`
   (JavaScript in YAML, untestable).
5. **The runner never triggers itself.** Its own comments carry the marker, its own labels are in the policy, and the
   signal exits 0 for both, for comments without a command and for bot senders; the workflow's `if:` repeats the bot
   check. Concurrency is one group per issue with `cancel-in-progress: false`, which is exactly "newer queued cancels
   older queued, never the running one".
6. **Branch and task names agree with spec 015.** The implementation task is named `issue`, so
   `agent/issue-<n>-<slug>` resolves to it in the existing guard job; the gate task is `issue-gate` and never has a
   branch. Pull requests are deduplicated per issue (`agent/issue-<n>-`), not per task.
7. **A `fake` harness is first-class.** `tooling/agents/fake-harness.mjs` answers every prompt with canned output keyed
   on the task name, so the whole path (trigger, labels, comments, branch, draft pull request, verification comment) runs
   on GitHub Actions with the repository variable `AGENT_HARNESS=fake` and no model key. Every artefact of a fake run says
   so. Rejected: skipping the whole job without a key (then nothing can be proved before spending).
8. **Outsiders get the structural gate, collaborators get the model** by default (`issues.modelFor`). Anyone can open an
   issue on a public repository; the read-only gate is cheap but not free, and the plan is not. A maintainer's `/plan`
   starts the rest for an outside author.

Left out on purpose: a dashboard or cross-repository view, mid-run steering, `/review` on pull requests the runner did
not open, cost budgets per issue (the API key's spend limit is the budget), and any harness other than `claude` and
`fake` in the issue job (the scheduled job's key mapping for Codex and Gemini still applies to it).

## Principles

Harness engineering, as this repository practices it: the model is the reasoning engine; the environment around it
decides what it can touch, what survives a session, what counts as evidence and when it must stop. Three rules follow,
each already enforced somewhere in the runner and named here so future work keeps them:

1. **Every rule is encoded twice.** Once as prose the model reads (`AGENTS.md`, a task body) and once as a check it
   cannot bypass (the guard, a gate, `spec:check`, a unit test). A rule that exists only as prose is a request.
2. **The loop belongs to the runner.** Evidence, bounded retries, budgets and escalation are the runner's: signal
   first, gates after, one fix attempt, a spend ceiling (REQ-ISS-023), a label for a person. The model repairs one
   local gap; it never decides whether another attempt is allowed.
3. **Reasoning, hands and history are separate.** The model proposes; the runner holds the tools and permissions
   (`policy.json`, the GitHub client, the allow-lists); history lives in files and on the issue (labels, markers
   from the runner's identity only, REQ-ISS-024; `.agents/out/`, the receipt, REQ-ISS-026). A failed run names the
   harness gap it suspects (REQ-ISS-025), so failure upgrades the system rather than the prompt.

The environment is the system of record (`AGENTS.md`, "Unattended agents"). A new session rebuilds from files and the
issue, never from a chat transcript.
