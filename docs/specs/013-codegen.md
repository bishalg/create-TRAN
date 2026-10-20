# 013 Code generation and scaffolding

Scope: `crates/tran-tokens-codegen` — the in-repo binary behind `pnpm tokens:sync` / `pnpm i18n:sync` that turns
`rust-core` tokens, rules, the feedback catalogue and `locales/` into TypeScript, CSS, Swift, Kotlin, String Catalogs,
Android resources and `DESIGN.md`; and `packages/create-tran`, which turns this repository into a new project.
Rationale: [ADR-0030](../adr/0030-generated-files-are-the-snapshots.md).

### REQ-GEN-001 [verified] `cargo test` fails when a generated file is stale

Rendering every artifact in memory MUST reproduce each committed generated file byte for byte; a mismatch MUST fail
`cargo test` and name the stale path and the command that fixes it.

### REQ-GEN-002 [verified] The generator is fully tested, not excluded

`crates/tran-tokens-codegen` MUST be under the 100% line and region coverage gate, except `main.rs`, which only
creates directories, writes, prunes and prints. Every rule that rejects a broken `locales/` tree (REQ-I18N-003) MUST
have a test that feeds it one and checks the error names the offending file or key.

### REQ-GEN-003 [verified] Stale generated files are removed, nothing else is

Pruning MUST delete only generated files of the matching kind that this run did not write, MUST remove a folder it
emptied, and MUST leave other files and a missing folder alone.

### REQ-GEN-004 [verified] Scaffolding the real template applies every customization

Running `create-tran` against this repository's own files (not a hand-made fixture) with a new prefix, primary
colour, default theme and display name MUST: replace both template primaries in `tokens.rs` and set the default theme;
rename the prefix in package names, crate names, the iOS target folders and the Android package path; leave
`tooling/design-tokens/codegen.json` pointing at folders that exist; and leave a Cargo workspace that `cargo metadata`
accepts.
