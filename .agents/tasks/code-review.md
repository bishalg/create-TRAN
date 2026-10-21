---
name: code-review
summary: Review a pull request's diff against this repo's rules; report findings, change nothing.
trigger: pull_request
signal: pr-diff
mode: read-only
deliverable: report
gates: []
evidence_lines: 1500
timeout_minutes: 15
---

Review the diff in the evidence. You are the second pair of eyes before a person reviews it.

Check, in this order, and only what the diff touches:

1. **Correctness.** Logic errors, unhandled failure paths, wrong edge cases, races. Read the surrounding code
   before you claim a bug.
2. **Spec traceability.** New behaviour has a requirement in `docs/specs/` and a test citing it. No requirement
   flipped to `[verified]` without a citing test.
3. **Single source of truth.** Rule data, tokens and strings change in Rust or `locales/` and are regenerated,
   never hand-edited in a `generated/` file or in `DESIGN.md`.
4. **Atoms.** Web features use the atoms in `apps/web/src/shared/ui/`, no inline `style`.
5. **Tests.** Assertions that could not fail, tests that were weakened or skipped, thresholds lowered.
6. **Output hygiene.** No logs, screenshots, coverage or reports committed outside `docs/reports/`.

Do not report what formatters, clippy, ESLint or the type checker already catch.
Do not suggest refactors the change did not need.

Report format, in markdown:

- A one-line verdict: `Looks good`, `Needs changes` or `Blocking issue`.
- Then each finding as a bullet: **severity** (blocking, should-fix, nit), `file:line`, what is wrong, why it matters,
  and the smallest fix. One or two sentences each.
- Nothing else. No praise, no summary of the diff. Zero findings is a valid review.
