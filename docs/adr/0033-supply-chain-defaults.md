# ADR-0033: Supply-chain defaults a fork inherits

**Status:** Accepted · **Date:** 2026-10-22 · **Spec:** [016](../specs/016-supply-chain.md)

## Context

The template had everything about the code it writes and nothing about the code it pulls in. `pnpm audit` reported
18 advisories, two critical, all transitive (`tinypool` under vitest, `undici` under nx, `qs` under Stryker). Only
the agents workflow pinned its actions by commit; the other workflows used `@v4` tags, which a compromised
or re-tagged release can change silently. There was no Dependabot configuration, so nothing would have told a fork.
There was no `SECURITY.md`, so a reporter's only option was a public issue.

A template is forked more often than it is read: whatever it ships becomes the default for every project made from
it.

## Decision

1. **Audits are a CI gate**, not a weekly task: `pnpm audit --audit-level high` and `cargo audit --deny warnings` run
   in the existing jobs. The audit agent task stays as the thing that proposes the fix.
2. **Transitive fixes are ranged overrides** in `pnpm-workspace.yaml` (`'undici@>=7 <7.29.1': '>=7.29.1'`). Keying by
   the vulnerable range means the override does nothing once the dependant bumps, so stale overrides cannot pin an
   old version forever. A bare-name override fails `pnpm supply:check`.
3. **Every action is pinned to a commit SHA** with the version as a comment, including the tool-installer: the
   `@cargo-llvm-cov` tag became `@<sha>` plus `with: tool:`.
4. **Dependabot is configured** for npm, cargo, gradle and GitHub Actions, grouped minor and patch, weekly, five
   open pull requests per ecosystem. Security updates are not grouped.
5. **`SECURITY.md`** points at GitHub private vulnerability reporting and lists what is enforced.
6. **`pnpm supply:check`** keeps 2 to 5 true; it runs in CI and in `pnpm check:quick`, and it derives the required
   Dependabot ecosystems from the files present, so removing `apps/android` removes the gradle requirement.

## Consequences

- A fork gets Dependabot pull requests from its first week and a failing CI on the first advisory. Both need the
  repository settings turned on (Dependabot, private reporting); `SECURITY.md` says so.
- Upgrading vitest from 3 to 5 was the fix for the critical advisories; the 100% coverage gate and Stryker's runner
  were unaffected. Major upgrades to fix advisories are expected and preferred over overrides when tests pass.
- SHA pins are unreadable on their own; the version comment and Dependabot's bumps are what keep them honest.
- `cargo audit` runs locally only when installed (`cargo install cargo-audit --locked`); the agent signal already
  tolerates its absence, and CI does not.
