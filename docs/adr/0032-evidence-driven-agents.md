# ADR-0032 Evidence-driven agents, defined once for every harness

Status: accepted

## Context

Teams run coding agents on a schedule: Jules scheduled tasks, Claude Code or Codex in GitHub Actions, a cron job on a
VPS, a custom harness such as pi. The common pattern is a persona prompt ("You are Bolt…") that must find ONE
improvement every week. That pattern produces drift:

- **A quota invents work.** An agent that must ship something ships something, whether the code needed it or not.
- **Generic checklists.** "Add React.memo, add a database index" in a repo with neither problem.
- **"Ask first" has nobody to ask.** An unattended agent guesses or stalls.
- **Self-reported verification.** The PR says tests pass because the agent says so.
- **Knowledge scattered** across per-persona journals no other agent or person reads.
- **Lock-in.** Each platform has its own prompt store, schedule UI and rules file.

This repo already produces mechanical signals: `spec:check`, `pnpm metrics` budgets, mutation reports, audits.

## Decision

An agent task is a markdown file in `.agents/tasks/`: frontmatter for the machine (trigger, signal, mode, scope,
gates, deliverable), a short body for the model. A small runner, `tooling/agents/agents.mjs`, owns everything that
must not depend on the model:

1. **Signal first.** It runs the task's signal. No signal, no agent: exit 0 ends the run before any model starts.
2. **One prompt.** It assembles the same prompt from repo files for every harness, with the evidence inlined.
3. **Thin adapters.** It starts the chosen harness headless (`claude -p`, `codex exec`, `gemini -p`, `pi -p`, `jules
remote new`, or any command reading stdin), in the harness's read-only mode for review tasks.
4. **Verify outside the model.** After an edit it runs the guard (scope, protected paths, line budget from
   `.agents/policy.json`) and the gates itself. Only then does it commit, and with `--publish` open a **draft** PR.
   Nothing auto-merges.

Scheduling stays outside the repo's concern: the same `pnpm agents run <task>` works from cron, launchd, systemd, a
VPS, or `.github/workflows/agents.yml`, whose crons are checked against the task files. Rules stay in `AGENTS.md`
(read natively by most harnesses; `CLAUDE.md` and `.gemini/settings.json` point at it). Procedures stay in
`.agents/skills/` (the Agent Skills format). Durable lessons go to one `docs/LEARNINGS.md`; decisions still become
ADRs and bugs still become tests.

## Consequences

- Any harness can run any task, and switching harness changes one flag, not the prompts.
- An agent that finds nothing does nothing; quiet weeks cost nothing.
- Agents cannot edit their own rules: `.agents/`, `AGENTS.md`, CI and dependency manifests are protected unless a
  task file, which only a person can change, allows a path.
- Jules runs asynchronously in Google's VM, so the runner cannot verify it; its PR is checked by the guard job in CI.
- The runner is plain Node with no dependencies, tested with `node --test` like the other tooling; it is not in the
  100% coverage gate, which covers the sample app.
- Enforced by `pnpm agents:check` (task files, schedules, learnings format) in CI and the guard job on `agent/` PRs.
