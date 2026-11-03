---
name: issue
summary: Implement the approved plan of one GitHub issue, spec and failing test first, in one draft pull request.
trigger: issue
on: [opened, edited, commented]
signal: issue-event
mode: edit
deliverable: pr
scope: [docs/specs/, crates/, packages/, apps/, e2e/, fixtures/, locales/, docs/LEARNINGS.md]
gates: [pnpm spec:check, pnpm agents:check, pnpm test]
max_changed_lines: 300
evidence_lines: 400
timeout_minutes: 45
---

The evidence is one GitHub issue that passed the runner's quality check, and the prompt ends with the plan a
maintainer approved. Implement that plan and nothing more. The runner has already put you on the branch
`agent/issue-<n>-<slug>`; it commits, pushes and opens the draft pull request that closes the issue.

1. Read the issue's requirement ids in `docs/specs/`. Add a requirement that is missing, or update one the plan
   changes, as `[planned]`.
2. Write the failing test first and cite the id (`// Verifies: REQ-…` or the id in the test name). Run it and see it
   fail for the reason the issue describes.
3. Change the code until the test passes, following `AGENTS.md` for the area you touch (rules in `crates/rust-core`,
   generated files through their generator, UI through the shared atoms, a Gherkin scenario for visible behaviour).
4. Flip the requirement to `[verified]` only when a test cites it.
5. Run the gates yourself before you stop.

A change to a code file without a change to a test file is not kept. Documentation, specs and fixtures need no test.

Stop with `NO-CHANGE: <reason>` when the plan needs a file outside your scope (a dependency, CI, the agent setup), a
product or architecture decision, or more than the line budget; say in the detail what a person has to decide.

The hand-off's **What**, **Why**, **Verification** and **Risk** become the sections of the pull request; name the
requirement ids under **Why** and the commands you ran under **Verification**.
