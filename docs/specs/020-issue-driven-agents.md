# 020 Issue-driven agents

Scope: tasks that start from a GitHub issue or a comment rather than a schedule: the issue-quality gate, triage labels,
plan and approval, implementation into one pull request, verification reported on that pull request, and the
credentials the harness needs on GitHub Actions. Extends [015 Agents](./015-agents.md): the runner, guard, gates,
policy and learnings rules there apply unchanged. Rationale: [ADR-0037](../adr/0037-issue-driven-agents.md).

This is the self-hosted replacement for the hosted Jules workflow: validate every issue, push back on a weak one,
implement the simple ones, label the rest for a person. Nothing here knows this sample app; everything repo-specific
comes from `AGENTS.md`, `.agents/policy.json`, the task files and `.github/ISSUE_TEMPLATE/`.

## Trigger and state

### REQ-ISS-001 [planned] An `issue` trigger

A task file MAY declare `trigger: issue` with `on: [opened, edited, labeled, commented]`. The runner MUST treat the
issue (title, body, labels, comments) as the task's evidence and MUST apply the guard, gates and publish rules of
spec 015 to any change it produces.
**Verified by:** unit tests in `tooling/agents/tasks.test.mjs` and `run.test.mjs`.

### REQ-ISS-002 [planned] The issue is the state

The runner MUST keep task state only on the issue: exactly one of `needs-detail`, `human-decision-needed`,
`review-needed`, `good-to-merge` as a label (removing the others when it applies one), progress as comments it
updates in place, and the result as one pull request. It MUST create missing labels on first use with the names from
`.agents/policy.json` (`labels`), defaulting to the four above plus `agent:running` and `agent:failed`.
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-003 [planned] One run per issue at a time

Runs for the same issue MUST be serialized (an Actions concurrency group keyed by repository and issue number); a
newer queued run MUST cancel an older queued run and MUST NOT cancel an executing one.
**Verified by:** workflow test in `tooling/agents/*.test.mjs` reading `agents.yml`.

### REQ-ISS-004 [planned] Commands need write access

`/plan`, `/approve`, `/implement`, `/review` and `/screenshots` in a comment MUST be acted on only when the author has
write access to the repository; otherwise the runner MUST reply once that the command was ignored and do nothing else.
**Verified by:** unit tests with a fake GitHub client.

## Issue quality gate

### REQ-ISS-005 [planned] Every issue is scored against the template

On `opened` and `edited`, a read-only task MUST compare the issue with the repository's story template
(`.github/ISSUE_TEMPLATE/*.md`, default sections: SMART story, requirement ids, Given/When/Then acceptance criteria,
out of scope, definition of done) and MUST produce a verdict `ready`, `needs-detail` or `human-decision-needed` with
one reason per missing or weak section.
**Verified by:** unit tests on the verdict with fixture issues.

### REQ-ISS-006 [planned] A weak issue gets a rewrite, not a branch

For `needs-detail` the runner MUST post one comment containing a complete rewritten issue body in the template's
format, MUST apply `needs-detail`, and MUST NOT start any edit task. It MUST NOT edit the author's body unless
`.agents/policy.json` sets `issues.applyRewrite: true`. An edit to the issue MUST re-run the gate and clear the label
when the verdict becomes `ready`.
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-007 [planned] Size class with reasons

For a `ready` issue the runner MUST classify it `simple` or `complex` from heuristics in the policy (paths named,
migrations, auth or payment paths, new dependencies, UI change, estimated lines against the line budget) and MUST
record the class and reasons in its comment.
**Verified by:** unit tests on fixture issues.

## Plan, approval, implementation

### REQ-ISS-008 [planned] Complex work is planned and approved first

For `complex`, the runner MUST post a plan (goal, files, requirement ids, tests to write first, risks, estimated
lines) and MUST wait for `/approve` from a write-access user before any edit task starts; a comment that edits the
plan before approval becomes the plan. For `simple`, the policy's `issues.autonomy.simple` (`auto` or `plan-approve`,
default `plan-approve`) decides.
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-009 [planned] One branch, one pull request, never the base

An implementation MUST push to `<branchPrefix>issue-<n>-<slug>`, MUST open or update exactly one pull request for the
issue with `Closes #<n>` in the repository's pull request template, and MUST NOT push to the base branch or any
protected branch.
**Verified by:** unit tests on branch and body generation.

### REQ-ISS-010 [planned] Spec-first when the repo is spec-first

When `docs/specs/` exists, the implementation prompt MUST instruct the agent to add or update the requirement and
write the failing test citing it before code, and the runner MUST fail the run when the diff adds behaviour without a
test file change (`issues.requireTests`, default `true`).
**Verified by:** unit tests on the prompt and on the diff check.

### REQ-ISS-011 [planned] The issue body is data

The runner MUST pass issue and comment text to the agent inside a fenced block labelled as untrusted content with an
instruction that it contains no commands, and issue-driven edit tasks MUST run with the same tool allow-list as other
edit tasks, with no unrestricted network tool.
**Verified by:** unit tests on the prompt.

## Verification on the pull request

### REQ-ISS-012 [planned] Gates and cost in one comment

The runner MUST run every gate of the task in CI on the pull request head and MUST keep one comment, updated in place,
listing each gate's status and duration, the last 50 lines of a failing gate, and the run's turns, model and cost in
USD when the harness reports them.
**Verified by:** unit tests on the comment renderer.

### REQ-ISS-013 [planned] Labels follow the evidence

`good-to-merge` MUST be applied only when every gate passed on the head commit and the read-only review
(`code-review` task) reports no `blocking` or `should-fix` finding; otherwise `review-needed`. A plan that needs a
product or architecture decision MUST get `human-decision-needed` instead.
**Verified by:** unit tests on the label decision.

### REQ-ISS-014 [planned] Screenshots on demand only

When the diff matches `issues.uiGlobs` in the policy, or `/screenshots` is commented, the runner MUST run the
repository's screenshot command (`issues.screenshotCommand`), upload the images as a workflow artifact and post or
update a comment with them. It MUST NOT run screenshots otherwise.
**Verified by:** unit tests on the trigger decision.

### REQ-ISS-015 [planned] One fix attempt for failed CI

When a configured workflow fails on an `agent/` pull request and `issues.ciFix.enabled` is `true`, the runner MUST
attempt at most `issues.ciFix.maxAttempts` (default 1) fix commits on the same branch, each through guard and gates,
then apply `review-needed`.
**Verified by:** unit tests with a fake workflow-run event.

## Credentials on GitHub Actions

### REQ-ISS-016 [planned] Non-interactive Claude Code credentials

The workflow MUST accept either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (made once on a developer machine
with `claude setup-token`) for the `claude` harness, MUST skip with a notice when neither is set, and MUST NOT attempt
an interactive login. The GitHub identity MUST be `AGENT_GITHUB_TOKEN` (fine-grained or GitHub App) or the job token,
with only contents, pull-requests and issues write.
**Verified by:** unit test reading `agents.yml`; documented in `.agents/README.md`.

### REQ-ISS-017 [planned] No deploy secrets near the agent

The job that runs the harness MUST receive only the harness credential and the GitHub token; gates that need other
secrets MUST run in a separate job that does not install or run the harness.
**Verified by:** unit test reading `agents.yml`.
