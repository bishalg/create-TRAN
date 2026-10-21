---
name: mutation-survivors
summary: Add the test that kills one surviving mutant.
trigger: manual
signal: mutants-missed
mode: edit
deliverable: pr
scope:
  [crates/rust-core/, apps/api/, crates/tran-tokens-codegen/, packages/core-ts/, docs/LEARNINGS.md]
gates:
  [pnpm test, cargo clippy --workspace --all-targets -- -D warnings, cargo fmt --all -- --check]
max_changed_lines: 120
---

The evidence lists mutants that survived: small bugs planted in the code that no test noticed. Each one is a missing
assertion.

1. Pick one mutant in business logic (`crates/rust-core` first).
2. Write a test that fails with the mutant applied and passes without it. Assert the behaviour, not the
   implementation. Cite the requirement the behaviour belongs to.
3. Change tests only. If the mutant is equivalent (no behaviour can tell it apart), add no test; explain why in the
   hand-off. A person then lists a Rust mutant in `.cargo/mutants.toml`, or marks a TypeScript one with a
   `// Stryker disable next-line <Mutator>: <reason>` comment.
4. A Stryker mutant with `static: true` and no covering tests runs at module load; it is a tooling artefact, not a
   missing assertion (see `docs/LEARNINGS.md`). Skip it.
