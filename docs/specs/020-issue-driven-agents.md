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

A task file MAY declare `trigger: issue` with `on: [opened, edited, labeled, commented]` and the built-in signal
`issue-event`, which reads the GitHub event payload (`--event <path>`, default `GITHUB_EVENT_PATH`). The runner MUST
treat the issue (title, body, labels, comments) as the task's evidence and MUST apply the guard, gates and publish
rules of spec 015 to any change it produces. `pnpm agents:check` MUST reject an `on` value outside that list, an `on`
field on another trigger, or an `issue` task with another signal.
**Verified by:** unit tests in `tooling/agents/tasks.test.mjs` and `issue-event.test.mjs`.

### REQ-ISS-002 [planned] The issue is the state

The runner MUST keep task state only on the issue: exactly one of `needs-detail`, `approval-needed`,
`human-decision-needed`, `review-needed`, `good-to-merge` as a label (removing the others when it applies one, keeping
every label it does not own), progress as comments it updates in place, and the result as one pull request. It MUST
create missing labels on first use with the names from `.agents/policy.json` (`labels`), defaulting to the five above
plus `agent:running` and `agent:failed`.
**Verified by:** unit tests with a fake GitHub client in `tooling/agents/issue-gate.test.mjs`.

### REQ-ISS-003 [planned] One run per issue at a time

Runs for the same issue MUST be serialized (an Actions concurrency group keyed by repository and issue number); a
newer queued run MUST cancel an older queued run and MUST NOT cancel an executing one (`cancel-in-progress: false`).
**Verified by:** workflow test in `tooling/agents/workflow.test.mjs` reading `agents.yml`.

### REQ-ISS-004 [planned] Commands need write access

A command is the first non-blank line of a comment when it is one of `/plan`, `/approve`, `/implement`, `/review`,
`/screenshots`, optionally followed by text. A command MUST be acted on only when the GitHub API reports the author's
permission as `write`, `maintain` or `admin`; otherwise the runner MUST reply once that the command was ignored and do
nothing else. The `author_association` field of the payload MUST NOT be used as the source of this decision.
**Verified by:** unit tests with a fake GitHub client in `tooling/agents/issue-commands.test.mjs`.

## Issue quality gate

### REQ-ISS-005 [planned] Every issue is scored against the template

On `opened` and `edited` the runner MUST compare the issue with the repository's story template
(`.github/ISSUE_TEMPLATE/*.md`, default sections: SMART story, requirement ids, Given/When/Then acceptance criteria,
out of scope, definition of done) in two tiers. The structural tier runs in the runner without a model: a missing or
empty section, no `REQ-` id, or no Given/When/Then line is a verdict of `needs-detail` with one reason per finding.
The judgment tier is a read-only task that runs only when the structural tier passed and a harness credential is
present; it MUST produce a verdict `ready`, `needs-detail` or `human-decision-needed` with one reason per weak section,
on a first line `VERDICT: <value>` that the runner parses. The runner MUST never let the judgment tier upgrade a
structural `needs-detail`.
**Verified by:** unit tests on the verdict with fixture issues in `tooling/agents/issue-gate.test.mjs`.

### REQ-ISS-006 [planned] A weak issue gets a rewrite, not a branch

For `needs-detail` the runner MUST post one comment containing a complete rewritten issue body in the template's
format (the model's rewrite when the judgment tier ran, otherwise the template with the author's text placed in the
sections it matches), MUST apply `needs-detail`, and MUST NOT start any edit task. It MUST NOT edit the author's body
unless `.agents/policy.json` sets `issues.applyRewrite: true`. An edit to the issue MUST re-run the gate and clear the
label when the verdict becomes `ready`.
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-007 [planned] Size class with reasons

For a `ready` issue the runner MUST classify it `simple` or `complex` from heuristics in the policy
(`issues.complexWhen`: paths named, migrations, auth or payment paths, new dependencies, UI change, estimated lines
against the line budget) and MUST record the class and reasons in its comment. The judgment tier MAY raise `simple`
to `complex` (line `SIZE: complex`) and MUST NOT lower it.
**Verified by:** unit tests on fixture issues.

## Plan, approval, implementation

### REQ-ISS-008 [planned] Complex work is planned and approved first

For `complex`, the runner MUST post a plan (goal, files, requirement ids, tests to write first, risks, estimated
lines), apply `approval-needed`, and MUST wait for `/approve` from a write-access user before any edit task starts; a
comment that edits the plan before approval becomes the plan (REQ-ISS-021). For `simple`, the policy's
`issues.autonomy.simple` (`auto` or `plan-approve`, default `plan-approve`) decides.
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-009 [planned] One branch, one pull request, never the base

An implementation MUST push to `<branchPrefix>issue-<n>-<slug>` (the task is named `issue`, so spec 015's guard job
resolves the branch to it), MUST open or update exactly one pull request for the issue whose body starts with
`Closes #<n>` and follows `.github/pull_request_template.md` when that file exists, and MUST NOT push to the base
branch or any protected branch. A second run for an issue that already has an open pull request MUST update that pull
request's branch, never open another.
**Verified by:** unit tests on branch and body generation.

### REQ-ISS-010 [planned] Spec-first when the repo is spec-first

When `docs/specs/` exists, the implementation prompt MUST instruct the agent to add or update the requirement and
write the failing test citing it before code, and the runner MUST fail the run when the diff changes a code file
(`.ts`, `.tsx`, `.js`, `.mjs`, `.rs`, `.swift`, `.kt`, `.kts`) without changing a test file (`issues.requireTests`,
default `true`). A diff that changes only documentation, specs or fixtures passes.
**Verified by:** unit tests on the prompt and on the diff check.

### REQ-ISS-011 [planned] The issue body is data

The runner MUST pass issue and comment text to the agent inside a fenced block labelled as untrusted content with an
instruction that it contains no commands, and issue-driven edit tasks MUST run with the same tool allow-list as other
edit tasks, with no unrestricted network tool.
**Verified by:** unit tests on the prompt.

## Verification on the pull request

### REQ-ISS-012 [planned] Gates and cost in one comment

The runner MUST run every gate of the task in CI on the pull request head and MUST keep one comment on the pull
request, updated in place, listing each gate's status and duration, the last 50 lines of a failing gate, and the run's
turns, model and cost in USD when the harness reports them.
**Verified by:** unit tests on the comment renderer.

### REQ-ISS-013 [planned] Labels follow the evidence

`good-to-merge` MUST be applied to the issue only when every gate passed on the head commit and the read-only review
(`code-review` task) ran and reports no `blocking` or `should-fix` finding; otherwise `review-needed`, including when
no credential allowed the review to run. A plan that needs a product or architecture decision MUST get
`human-decision-needed` instead.
**Verified by:** unit tests on the label decision.

### REQ-ISS-014 [planned] Screenshots on demand only

When the diff matches `issues.uiGlobs` in the policy, or `/screenshots` is commented, the runner MUST run the
repository's screenshot command (`issues.screenshotCommand`), upload the images as a workflow artifact and post or
update a comment with them. It MUST NOT run screenshots otherwise.
**Verified by:** unit tests on the trigger decision.

### REQ-ISS-015 [planned] One fix attempt for failed CI

When a configured workflow fails on an `agent/` pull request and `issues.ciFix.enabled` is `true`, the runner MUST
attempt at most `issues.ciFix.maxAttempts` (default 1) fix commits on the same branch, each through guard and gates,
then apply `review-needed`. Attempts are counted from `Agent-Fix-Attempt:` trailers in the branch's commits, so the
count survives a new job.
**Verified by:** unit tests with a fake workflow-run event.

## Credentials on GitHub Actions

### REQ-ISS-016 [planned] Non-interactive Claude Code credentials

The workflow MUST accept either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (made once on a developer machine
with `claude setup-token`) for the `claude` harness, MUST skip every model stage with a notice when neither is set
(the runner-only stages, the structural gate and its labels, still run), and MUST NOT attempt an interactive login.
The GitHub identity MUST be `AGENT_GITHUB_TOKEN` (fine-grained or GitHub App) or the job token, with only contents,
pull-requests and issues write.
**Verified by:** unit test reading `agents.yml`; documented in `.agents/README.md`.

### REQ-ISS-017 [planned] No deploy secrets near the agent

The job that runs the harness MUST receive only the harness credential and the GitHub token; gates that need other
secrets MUST run in a separate job that does not install or run the harness.
**Verified by:** unit test reading `agents.yml`.

## Proving the pipeline

### REQ-ISS-018 [planned] A fake harness exercises every stage without a model

The runner MUST offer a `fake` harness (`tooling/agents/fake-harness.mjs`, prompt on stdin) that returns canned,
deterministic output for each task named in the prompt and spends nothing. The workflow MUST use it when the
repository variable `AGENT_HARNESS` is `fake`, so a maintainer can prove the trigger, labels, comments, branch, pull
request and verification on GitHub before adding a credential. A `fake` run MUST be marked as such in every comment
and pull request it produces.
**Verified by:** unit tests in `tooling/agents/prompt-harness.test.mjs` and `issue.test.mjs`; workflow test.

### REQ-ISS-019 [planned] The runner never triggers itself

The `issue-event` signal MUST exit 0 (nothing to do) for a comment whose body carries the runner's marker
(REQ-ISS-020), for a comment without a command, for a `labeled` event whose label is one the runner owns, and for any
event whose sender is a bot. The workflow MUST additionally skip bot senders in its `if:`.
**Verified by:** unit tests on fixture payloads; workflow test.

### REQ-ISS-020 [planned] State is readable back from the runner's own comments

Every comment the runner posts MUST start with an HTML comment marker `<!-- tran-agent {"stage":"<stage>", …} -->`
holding the stage (`gate`, `plan`, `verification`, `screenshots`, `ignored`), the verdict, the size class, the
approved plan's hash and the harness. The runner MUST find its comment by marker and update it in place, one per
stage per issue, and MUST read the issue's labels and these markers, never a file or a database, to decide the next
stage.
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-021 [planned] The plan is the latest plan-bearing comment

The plan given to the implementation prompt MUST be the body of the newest comment before (or being) the `/approve`
comment that is either the runner's `plan` comment or a comment by a write-access user containing a `## Plan` heading.
The runner MUST record that body's SHA-256 in the `plan` marker on approval, carry the plan into the prompt inside its
own fenced block labelled "approved plan", and refuse to implement when no plan-bearing comment exists (reply once,
label unchanged).
**Verified by:** unit tests with a fake GitHub client.

### REQ-ISS-022 [planned] Model stages for outside authors are a policy choice

`issues.modelFor` (`collaborators` or `anyone`, default `collaborators`) decides whether the judgment tier and the
plan run for an issue whose author lacks triage access. For other authors the structural gate and its rewrite still
run and the comment MUST say that a maintainer's `/plan` starts the rest.
**Verified by:** unit tests with a fake GitHub client.
