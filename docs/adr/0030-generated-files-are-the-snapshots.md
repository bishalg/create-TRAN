# ADR-0030 The committed generated files are the codegen snapshots

Status: accepted

## Context

`tran-tokens-codegen` writes every artifact that other languages consume: TypeScript tokens, rules, feedback and
strings; CSS; Swift and Kotlin tokens and string accessors; String Catalogs; Android resources; the root `DESIGN.md`
(ADR-0025 to ADR-0028). Almost all of it lived in a 1 300-line `main.rs` that the coverage gate excluded, so the code
that decides what every platform sees was the least tested code in the repository. Drift was caught only by CI's
`git diff --exit-code` after running the binary — never by `cargo test`, and never locally before a push.

The usual answer is snapshot testing (`insta`). Here it would duplicate what the repository already holds: every
output is committed, reviewed in diffs and consumed by the other suites.

## Decision

1. **The committed files are the snapshots.** The binary is a thin shell over `generate(&paths)`, a library function
   that returns every `(path, contents)` pair without touching the disk. A test renders the whole set and asserts each
   file equals the committed one, byte for byte. `cargo test` now fails on drift, with the stale path in the message.
2. **One module per target** (`tokens_ts`, `theme_css`, `swift`, `kotlin`, `strings`, `locales`, `scale`, `names`),
   each with its own unit tests for the cases the real data does not exercise.
3. **The crate is under the 100% coverage gate.** Only `main.rs` — argument-free I/O: create directories, write,
   prune, print — stays excluded. Every validation rule that guards `locales/` has a test that feeds it a broken
   dictionary and checks the message names the file and key.
4. Stale-file pruning is a library function tested against a temporary directory.

## Consequences

- Changing a generator without regenerating fails `cargo test` and the pre-push hook, not just CI.
- Reviewers still see generated changes as ordinary diffs; there is no second snapshot format to learn.
- The CI drift step stays as a second line of defence (it also covers UniFFI bindings, which this crate does not
  write).
