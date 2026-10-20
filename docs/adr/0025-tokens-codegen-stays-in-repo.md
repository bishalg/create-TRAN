# ADR-0025 — Token and string codegen stays in this monorepo

Status: accepted

## Context

The template needs one place to turn Rust design tokens and `locales/` dictionaries into
TypeScript, CSS, Swift, and Kotlin artifacts. That work already lives in
`crates/tran-tokens-codegen`, invoked as `pnpm tokens:sync` / `pnpm i18n:sync`.

A separate GitHub project (or a published “converter app”) would add a second install step,
a version pin between the token model and the emitters, and docs split across two repos —
too much friction for a hello-world “Use this template” flow with a single consumer.

## Decision

1. **Keep the converter in this workspace** as a **build-time binary**. Apps never link it at
   runtime; they commit the files it writes. Do not extract it to another repository until a
   second product consumes the same emitters against a stable token snapshot contract.
2. **Do not move `rust-core` or `tran-uniffi` out** with it. Those crates are the shared
   language for rules and native offline voting; the codegen binary is only a file writer.
3. **Drive output destinations from in-repo config**
   (`tooling/design-tokens/codegen.json`) so renaming the sample (Swift module path, Android
   package) does not require hunting hardcoded strings in the binary. Emitters stay beside
   the sample that uses them.

## Consequences

- `pnpm tokens:sync` keeps working after clone with no `cargo install` of an external tool.
- Renaming native package paths is a config edit plus regenerating and moving generated files.
- Publishing the emitters to crates.io remains allowed later; this ADR forbids premature
  extraction, not eventual reuse.
- Extends [ADR-0005](0005-generated-design-tokens.md) (tokens are generated) with placement
  and retargeting rules.
