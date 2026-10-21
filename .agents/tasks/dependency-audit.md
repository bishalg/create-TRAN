---
name: dependency-audit
summary: Fix one known-vulnerable dependency by the smallest version bump that clears it.
trigger: schedule
schedule: '29 5 * * 2'
signal: dependency-audit
mode: edit
deliverable: pr
scope:
  [
    package.json,
    pnpm-lock.yaml,
    Cargo.lock,
    packages/,
    apps/,
    crates/,
    e2e/,
    tooling/,
    docs/LEARNINGS.md,
  ]
allow: ['**/package.json', pnpm-lock.yaml, '**/Cargo.toml', Cargo.lock]
gates: [pnpm test, pnpm typecheck, cargo clippy --workspace --all-targets -- -D warnings]
max_changed_lines: 200
---

The evidence is the audit output. Fix the **most severe** advisory only.

1. Find the smallest version that clears the advisory: a patch or minor bump, within the existing range if possible.
2. Bump it with the package manager (`pnpm up <pkg>@<version>` or `cargo update -p <crate> --precise <version>`), never
   by editing a lockfile by hand.
3. A transitive dependency is bumped through its parent, or an override with a comment naming the advisory.
4. Do not change application code unless the bump requires it, and then only what the gates force.

Name the advisory id and both versions in the hand-off. If the fix needs a major upgrade, make no change and report
the advisory, the required major version and what breaks.
