---
name: spec-gap
summary: Turn one [planned] requirement into a failing test, then the code that makes it pass.
trigger: schedule
schedule: '17 5 * * 1'
signal: planned-requirements
mode: edit
deliverable: pr
scope: [docs/specs/, crates/, packages/, apps/, e2e/, fixtures/, locales/, docs/LEARNINGS.md]
gates:
  [
    pnpm spec:check,
    pnpm test,
    cargo clippy --workspace --all-targets -- -D warnings,
    cargo fmt --all -- --check,
  ]
skills: [ios-production, android-production]
max_changed_lines: 300
---

The evidence lists requirements still marked `[planned]`. Pick **one**, the smallest that can be finished in this
run. Prefer one whose spec says exactly how it is verified.

1. Read the requirement, its spec file and any ADR it links.
2. Write the test first and cite the id (`// Verifies: REQ-…`). Run it and see it fail for the right reason.
3. Make it pass with the smallest change that follows the existing patterns.
4. Flip the requirement to `[verified]` in the same change.

If every planned requirement needs a design decision, a new dependency or more than the line budget, make no change
and say which requirement is blocked and on what. That report is useful; a half-finished requirement is not.
