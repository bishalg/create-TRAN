# Agents

Unattended coding agents for this repo, defined once and runnable by any harness: Claude Code, Codex, Gemini CLI,
pi, Jules, or your own. Scheduled from wherever you like: cron on a laptop, a VPS, GitHub Actions.

The design in one sentence: **the model only edits; a small runner decides whether it starts, what it is told, and
whether its change is kept.** Rationale: [ADR-0032](../docs/adr/0032-evidence-driven-agents.md). Requirements:
[spec 015](../docs/specs/015-agents.md).

```
signal ──exit 0──► stop. Nothing to do, nothing spent.
  │
  └─exit ≠ 0─► prompt (AGENTS.md + task + evidence) ─► harness ─► guard ─► gates ─► commit ─► draft PR
                                                            (scope, protected     (run by the runner,
                                                             paths, line budget)   not by the agent)
```

> **A sample, off by default.** Nothing here runs on its own: no scheduler is installed, and the GitHub Actions
> schedules stay idle until you set `AGENTS_ENABLED`. Fork the template, read this page, adapt the task files, then
> switch on the scheduler you want. [Adopting it in your project](#adopting-it-in-your-project) is the checklist.

## Contents

- [Layout](#layout)
- [Quick start](#quick-start)
- [Adopting it in your project](#adopting-it-in-your-project)
- [The starter tasks](#the-starter-tasks)
- [Writing a task](#writing-a-task)
- [Harnesses](#harnesses)
- [Scheduling](#scheduling)
- [Safety model](#safety-model)
- [Where knowledge goes](#where-knowledge-goes)
- [From a persona prompt to a task](#from-a-persona-prompt-to-a-task)
- [Troubleshooting](#troubleshooting)

## Layout

| Path                                                              | What it holds                                                              | Who edits it          |
| :---------------------------------------------------------------- | :------------------------------------------------------------------------- | :-------------------- |
| [`AGENTS.md`](../AGENTS.md)                                       | Repo rules every agent and person follows. Inlined into every prompt.      | People                |
| [`.agents/tasks/*.md`](tasks/)                                    | One file per task: frontmatter for the runner, a short body for the model. | People                |
| [`.agents/policy.json`](policy.json)                              | Limits every task inherits: protected paths, line budget, timeouts.        | People                |
| [`.agents/skills/`](skills/)                                      | How-to knowledge in the [Agent Skills](https://agentskills.io) format.     | People, agents via PR |
| [`docs/LEARNINGS.md`](../docs/LEARNINGS.md)                       | Lessons that change how the next agent works here.                         | People and agents     |
| [`tooling/agents/agents.mjs`](../tooling/agents/agents.mjs)       | The runner. Plain Node, no dependencies.                                   | People                |
| [`.github/workflows/agents.yml`](../.github/workflows/agents.yml) | Optional scheduler on GitHub Actions, plus the guard and review jobs.      | People                |
| `.agents/out/<task>/`                                             | Per run: `prompt.md`, `harness.log`, `result.md`, `report.md`. Gitignored. | The runner            |

`CLAUDE.md` and `.gemini/settings.json` only point Claude Code and Gemini CLI at `AGENTS.md`. Codex, Jules, Cursor,
Copilot and pi read `AGENTS.md` directly.

## Quick start

```sh
pnpm agents list                              # tasks, triggers, schedules
pnpm agents signal spec-gap                   # what would the task see right now? exit 0 = nothing
pnpm agents run spec-gap --dry-run            # write the full prompt to .agents/out/spec-gap/prompt.md, start nothing
pnpm agents run spec-gap --harness pi         # run it: branch, agent, guard, gates, local commit
pnpm agents run spec-gap --harness claude --publish   # …and push a draft pull request (needs gh)
pnpm agents run code-review                   # review your branch against the default branch, read-only
pnpm agents:check                             # validate task files, workflow crons and LEARNINGS.md
```

An edit task needs a clean working tree: the runner measures the agent's change against it. It creates
`agent/<task>-<timestamp>`, and after a success switches back to the branch you were on. After a failure it leaves you
on the agent branch with the change and the reasons in `.agents/out/<task>/verification.md`.

## Adopting it in your project

The runner is generic; the task files, policy and signals are this repo's. In a fork, or when you copy the setup into
another repo:

1. **Copy** `AGENTS.md`, `.agents/`, `tooling/agents/` (one file plus its tests, plain Node 22, no dependencies),
   `docs/LEARNINGS.md`, and `.github/workflows/agents.yml` if you schedule on GitHub. Add `.agents/out/` to
   `.gitignore` and the `agents` / `agents:check` scripts to `package.json`.
2. **Rewrite `AGENTS.md`** for your repo: where the rules live, how to test, what "done" means. It is inlined into
   every prompt, so it is the single biggest lever on output quality. Keep it short.
3. **Set `.agents/policy.json`:** list your protected paths (rules files, CI, manifests, lockfiles, generated code,
   anything an agent must never touch unasked) and your default line budget.
4. **Keep one or two tasks, not six.** Start with `code-review` (read-only, no risk) and one edit task whose signal you
   already trust. For each: point `signal` at a command your repo already has (`pnpm lint`, `pnpm audit`, a coverage
   or budget check), set `scope` to the folders the fix may touch, and `gates` to the commands that must pass after it.
   Delete the rest; `pnpm agents:check` tells you what no longer matches.
5. **Try it by hand:** `pnpm agents signal <task>`, then `pnpm agents run <task> --dry-run` and read
   `.agents/out/<task>/prompt.md`. That file is exactly what any harness receives.
6. **Pick a harness and a scheduler** ([Harnesses](#harnesses), [Scheduling](#scheduling)). On GitHub: add the API key
   secret, `AGENT_GITHUB_TOKEN`, and the repository variable `AGENTS_ENABLED=true`.
7. **Watch the first pull requests closely.** When an agent gets something wrong, fix the cause where it belongs: a
   sharper task body, a tighter scope, a new protected path, or a `docs/LEARNINGS.md` entry. Not a longer prompt.

Not using Node? The runner only needs `node` to start; signals and gates are any shell command, so it works for Python,
Go or Rust repos as is.

## The starter tasks

| Task                                                | Trigger           | Signal (the evidence)                                 | Delivers                           |
| :-------------------------------------------------- | :---------------- | :---------------------------------------------------- | :--------------------------------- |
| [`code-review`](tasks/code-review.md)               | pull request      | `pr-diff`: the diff against the base branch           | A review comment, read-only        |
| [`spec-gap`](tasks/spec-gap.md)                     | Mondays 05:17 UTC | `planned-requirements` in `docs/specs/`               | Test + code for one REQ            |
| [`dependency-audit`](tasks/dependency-audit.md)     | Tuesdays          | `dependency-audit`: `pnpm audit`, `cargo audit`       | The smallest bump for one advisory |
| [`translation-review`](tasks/translation-review.md) | Saturdays         | `untranslated-strings`: Nepali/Hindi equal to English | Translations, regenerated          |
| [`metrics-watch`](tasks/metrics-watch.md)           | manual            | `pnpm metrics` failing a budget or regression         | A fix for one regression           |
| [`mutation-survivors`](tasks/mutation-survivors.md) | manual            | `mutants-missed`: surviving mutants in the reports    | The test that kills one            |

Every one of them can end with "no change". That is the point: there is no weekly quota.

## Writing a task

A task is a markdown file named after the task. The frontmatter is a small YAML subset (strings, integers,
`[inline, lists]`, `#` comments), so the runner needs no YAML library.

```markdown
---
name: spec-gap # = file name, kebab-case
summary: Turn one [planned] requirement into a failing test, then code.
trigger: schedule # schedule | pull_request | manual
schedule: '17 5 * * 1' # schedule only; must also be a cron in agents.yml
signal: planned-requirements # a built-in, or any shell command
mode: edit # edit | read-only
deliverable: pr # edit → pr, read-only → report
scope: [docs/specs/, crates/] # edit only: the paths it may change (dir/ = prefix)
allow: ['**/generated/'] # optional: protected paths this task may still change
gates: [pnpm spec:check, pnpm test] # run by the runner after the agent; all must pass
skills: [ios-production] # optional: .agents/skills/<name>/SKILL.md to read
max_changed_lines: 300 # optional: default from policy.json
evidence_lines: 200 # optional: how much signal output the agent sees
timeout_minutes: 30 # optional: the harness is killed after this
---

What to do with the evidence, in numbered steps. When to stop and make no change.
```

`pnpm agents:check` rejects a task with a missing or unknown field, a scope path that does not exist, a skill that
does not exist, a `pnpm` script that `package.json` does not define, or a cron that is not in the workflow. Renaming a
script or a folder breaks the check, not the Monday run.

### Signals

The signal is what makes a task evidence-driven. Exit 0 means nothing to do; any other exit means work, and the output
is the evidence; exit 126 or 127 (command missing) fails the run without starting the agent.

| Built-in               | Work when                                                              |
| :--------------------- | :--------------------------------------------------------------------- |
| `planned-requirements` | a requirement in `docs/specs/` is still `[planned]`                    |
| `untranslated-strings` | a non-English string equals English, except keys allowed in the policy |
| `mutants-missed`       | `mutants.out/missed.txt` or the Stryker report lists a survivor        |
| `pr-diff`              | the branch differs from `AGENT_BASE` (default: the default branch)     |
| `dependency-audit`     | `pnpm audit --audit-level high` or `cargo audit` reports an advisory   |

Any other value is a shell command: `signal: pnpm metrics`, `signal: ./scripts/find-todos.sh`, `signal: test -z "$(git
log --since=1.week --oneline -- docs/specs)"`. Write the check first, then the task: if you cannot write a command
that finds the problem, an agent will not reliably find it either.

### Body

Write it for a capable engineer who has never seen the repo and cannot ask you anything.

- **Name the evidence and the one thing to do with it.** "Pick one requirement", "fix the most severe advisory".
- **Say when to stop.** Every task needs a "make no change and report why" condition.
- **Point at the repo's own sources:** spec files, ADRs, `pnpm` scripts. No generic advice the model already knows.
- **Keep it under about 40 lines.** Rules shared by all tasks belong in `AGENTS.md` or `policy.json`, not repeated.

The runner adds the rest to every prompt: the limits, the gates, the evidence, the hand-off format and `AGENTS.md`.
Run `pnpm agents run <task> --dry-run` and read `.agents/out/<task>/prompt.md` to see exactly what the model gets.

## Harnesses

`--harness <name>`, or `AGENT_HARNESS` for a default. `AGENT_HARNESS_ARGS` adds arguments, such as a model.

| Harness  | Started as                            | Read-only tasks                 | Notes                                                        |
| :------- | :------------------------------------ | :------------------------------ | :----------------------------------------------------------- |
| `claude` | `claude -p`, prompt on stdin          | Edit, Write and Bash disallowed | Edit tasks may run `pnpm`, `cargo`, `node` and read-only git |
| `codex`  | `codex exec --sandbox … -`            | `--sandbox read-only`           | Edit tasks use `workspace-write`                             |
| `gemini` | `gemini -p`, prompt on stdin          | `--approval-mode plan`          | Edit tasks use `auto_edit`                                   |
| `pi`     | `pi -p --no-session @prompt.md`       | `--tools read`                  | Your pi extensions and skills load as usual                  |
| `jules`  | `jules remote new --repo owner/name`  | not enforced                    | Asynchronous: see below                                      |
| `custom` | `sh -c "$AGENT_CMD"`, prompt on stdin | checked after the run           | Any other harness: aider, opencode, a custom pi harness      |

Examples:

```sh
AGENT_HARNESS_ARGS="--model claude-sonnet-5-5" pnpm agents run spec-gap --harness claude
AGENT_HARNESS_ARGS="--provider anthropic --thinking high" pnpm agents run spec-gap --harness pi
AGENT_CMD="my-harness --headless --stdin" pnpm agents run spec-gap --harness custom
```

For a read-only task the runner also compares `git status` before and after, so even a harness without a read-only
mode cannot change files unnoticed.

**Jules** runs in Google's VM and opens its own pull request, so the runner can only hand it the prompt. Two ways:

- `pnpm agents run spec-gap --harness jules`: the runner checks the signal, then sends the prompt (`AGENT_REPO=owner/name`
  if the origin remote is not GitHub).
- Jules' own scheduler: paste `.agents/out/<task>/prompt.md` from a `--dry-run` as the scheduled task's prompt. It
  then skips the signal check, so keep the task body's "make no change" rule.

Either way, Jules does not run this runner's gates. Ask it to name its branch `agent/<task>-…` so the guard job checks
the pull request, or run `pnpm agents guard --task <task>` after `jules remote pull --apply`.

## Scheduling

The runner does not schedule anything; it is one command, so any scheduler works. Each scheduler only needs the repo,
the harness CLI with its key, and `gh` if you want pull requests.

**cron (Linux, macOS, a VPS).** Use a dedicated clone, so a run never touches the checkout you work in:

```cron
# m  h  dom mon dow  command
17   5  *   *   1    cd ~/agents/create-TRAN && git pull -q && pnpm install -s && pnpm agents run spec-gap --harness pi --publish >> ~/agents/log 2>&1
```

**systemd timer (a VPS).** `/etc/systemd/system/tran-agent@.service` plus a timer per task:

```ini
[Service]
Type=oneshot
User=agent
WorkingDirectory=/srv/create-TRAN
EnvironmentFile=/etc/tran-agent.env
ExecStartPre=/usr/bin/git pull -q
ExecStart=/usr/bin/pnpm agents run %i --publish

# tran-agent@spec-gap.timer
[Timer]
OnCalendar=Mon *-*-* 05:17:00 UTC
Persistent=true
```

**launchd (macOS).** A `~/Library/LaunchAgents/*.plist` with `StartCalendarInterval` running the same command.

**GitHub Actions.** [`agents.yml`](../.github/workflows/agents.yml) runs the scheduled tasks, any task by hand
(`gh workflow run agents.yml -f task=spec-gap -f harness=codex`), the guard on every `agent/` pull request, and the
read-only review when a maintainer labels a pull request `agent-review`. Schedules stay off until you set the
repository variable `AGENTS_ENABLED` to `true`; manual runs and the label need only the key. Add the secret for your harness
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`); without it, runs skip with a notice. Add
`AGENT_GITHUB_TOKEN` (fine-grained, contents and pull-requests write) so CI also runs on the agent's pull requests:
pull requests opened with the default token do not trigger other workflows.

When you add a scheduled task, add its cron to `agents.yml` too; `pnpm agents:check` fails until both agree. Other
schedulers are not checked: they live outside the repo.

## Safety model

What the runner guarantees, whatever the model does:

- **No signal, no run.** The model never starts without evidence.
- **Scope and protection.** A change outside the task's `scope`, or to a protected path (`AGENTS.md`, `.agents/`, CI,
  dependency manifests and lockfiles, ADRs, `docs/reports/`, generated code), is not kept. Only a task file can allow
  a protected path, and task files are themselves protected, so an agent cannot widen its own permissions.
- **A line budget** per task, 300 lines by default.
- **Gates run by the runner,** after the agent, from the task file. The agent's claim that tests pass is not trusted.
- **Draft pull requests only,** one open per task at a time. Nothing merges itself.
- **CI judges a pull request by the base branch's rules:** the guard job restores `.agents/` and the runner from the
  base branch before checking.

What you still own:

- **Credentials.** Give the harness a key with a spend limit, and the GitHub token only contents and pull-requests
  write on this repo.
- **Isolation.** Edit tasks run build tools and tests. On a VPS, run them as a dedicated user or in a container. Use a
  harness's "approve everything" mode (`--yolo`, `--dangerously-…`) only inside such a sandbox.
- **Prompt injection.** A pull request diff, an issue or a dependency's changelog is untrusted text. That is why the
  review task is read-only, why it runs only on same-repo pull requests a maintainer labels, and why edit tasks never
  read pull request content.
- **Review.** A person reviews and merges every agent pull request, like any other.

## Where knowledge goes

Agents drift when knowledge is scattered. One home per kind:

| Kind                                   | Home                             | Example                                             |
| :------------------------------------- | :------------------------------- | :-------------------------------------------------- |
| A rule everyone follows                | `AGENTS.md`                      | "Business rules live in `crates/rust-core`"         |
| What the system must do                | `docs/specs/` (`REQ-…`)          | REQ-NAT-012: the device check works in every locale |
| Why a design was chosen                | `docs/adr/`                      | ADR-0032 itself                                     |
| How to do something well, step by step | `.agents/skills/<name>/SKILL.md` | iOS production patterns                             |
| A lesson that would have saved an hour | `docs/LEARNINGS.md`              | Alert identifiers duplicate buttons on iOS 27       |
| What happened                          | git history, `docs/reports/`     | The metrics trend                                   |

There are no per-agent journals. A security lesson helps the reviewer, and a performance lesson helps the spec-gap
agent; one shared file means every agent and person reads all of them.

## From a persona prompt to a task

A typical scheduled persona prompt ("You are Bolt ⚡… find ONE performance improvement every Thursday… favourite
optimizations: React.memo, database indexes…") converts like this:

| Persona prompt                              | Task file                                                         |
| :------------------------------------------ | :---------------------------------------------------------------- |
| "Find ONE improvement" every week           | A `signal` that finds the problem; no signal, no run              |
| A generic checklist of 40 possible problems | The evidence from this repo's own check, and steps for it         |
| "Run lint and tests before the PR"          | `gates`, run by the runner; the change is dropped if one fails    |
| "Ask first before adding dependencies"      | `policy.json` protects manifests; the guard rejects the change    |
| "Never modify package.json"                 | The same protection, enforced instead of requested                |
| "Keep changes under 50 lines"               | `max_changed_lines`, enforced                                     |
| A journal per persona in `.jules/bolt.md`   | One `docs/LEARNINGS.md`; decisions become ADRs, bugs become tests |
| "If nothing found, stop"                    | Kept, and also enforced: exit 0 never starts the model            |
| Personality, emoji, philosophy              | Dropped. They cost tokens and do not change what gets checked     |

Bolt itself becomes [`metrics-watch`](tasks/metrics-watch.md): its signal is `pnpm metrics`, which already fails on a
Lighthouse score or bundle size regression with the numbers. A UX persona without a signal is better run by a person
with `--harness <name>` on demand than on a schedule.

## Troubleshooting

| Message                                       | Meaning                                                                             |
| :-------------------------------------------- | :---------------------------------------------------------------------------------- |
| `no-signal: … nothing to do`                  | Working as intended. Check with `pnpm agents signal <task>`.                        |
| `the working tree has uncommitted changes`    | Commit or stash; edit tasks need a clean tree. Use a dedicated clone for schedules. |
| `signal … could not run (exit 127)`           | The signal's command is not installed where the runner runs.                        |
| `the agent wrote no hand-off`                 | The harness stopped early or ignored the hand-off; read `harness.log`.              |
| `outside the task's scope` / `protected by …` | The agent strayed. Widen `scope` or `allow` only if the change was right.           |
| `already has an open pull request`            | Review or close the last one; one open pull request per task.                       |
| `dispatched`                                  | Jules has the task; its pull request appears in your repo.                          |
