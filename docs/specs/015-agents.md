# 015 Scheduled and micro-task agents

Scope: task definitions for unattended coding agents, the harness-neutral runner that starts them, the guard that
checks what they change, and the shared learnings file. Rationale: [ADR-0032](../adr/0032-evidence-driven-agents.md).
Setup guide: [`.agents/README.md`](../../.agents/README.md).

### REQ-AGT-001 [verified] Every task file is valid

`pnpm agents:check` MUST fail when a task in `.agents/tasks/` misses a required field (`name`, `summary`, `trigger`,
`signal`, `mode`, `deliverable`, `gates`), uses an unknown value, names a file other than its own, lists a scope path
that does not exist, names a skill that does not exist, or runs a `pnpm` script that `package.json` does not define.
An `edit` task MUST declare a `scope`; a `read-only` task MUST NOT.
**Verified by:** unit tests in `tooling/agents/agents.test.mjs`.

### REQ-AGT-002 [verified] Scheduled tasks match the workflow

Every `schedule` task's cron MUST appear in `.github/workflows/agents.yml`, and every cron there MUST belong to a task,
so a renamed or retimed task cannot silently stop running.
**Verified by:** unit tests.

### REQ-AGT-003 [verified] No signal, no run

Every task MUST name a signal: a built-in check or a shell command. Exit 0 means nothing to do, and the harness MUST
NOT start. A non-zero exit means work, and its output (truncated to a line budget) is the evidence given to the agent.
A signal that cannot run at all (exit 126 or 127) MUST fail the run without starting the harness.
**Verified by:** unit tests.

### REQ-AGT-004 [verified] One prompt for every harness

The prompt MUST be assembled only from files in the repo — `AGENTS.md`, the task body, the policy and the evidence —
and MUST be identical whichever harness runs it. It MUST state the mode, the allowed and protected paths, the line
budget, the gates and the hand-off file.
**Verified by:** unit tests.

### REQ-AGT-005 [verified] Harness adapters, read-only enforced by the harness

The runner MUST start Claude Code, Codex, Gemini CLI, pi, Jules or a custom command (`AGENT_CMD`, prompt on stdin).
A `read-only` task MUST use the harness's own read-only setting where it has one, and the run MUST fail if the
working tree changed anyway.
**Verified by:** unit tests.

### REQ-AGT-006 [verified] The runner verifies, not the agent

After an `edit` task, the runner MUST run the guard and every gate itself. It MUST commit, and with `--publish`
open a draft pull request, only when all pass; otherwise it MUST report the failures and open nothing. The runner
MUST refuse to start an `edit` task on a dirty working tree.
**Verified by:** unit tests.

### REQ-AGT-007 [verified] The guard limits what an agent may change

`pnpm agents guard` MUST fail when a changed file is outside the task's scope, is protected by `.agents/policy.json`
without the task allowing it, or when the change exceeds the task's line budget. It MUST run on every pull request
from an `agent/` branch.
**Verified by:** unit tests.

### REQ-AGT-008 [verified] One open pull request per task

With `--publish`, the runner MUST skip a task that already has an open pull request from its branch prefix, so a
recurring task never piles up duplicates.
**Verified by:** unit tests.

### REQ-AGT-009 [verified] Learnings are shared and structured

Agents and people MUST record durable lessons in one file, `docs/LEARNINGS.md`, each entry a dated heading with
**Learning:** and **Action:** lines. `pnpm agents:check` MUST fail on an entry that breaks this format.
**Verified by:** unit tests.
