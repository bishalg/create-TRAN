# ADR-0027 Rule data is generated from Rust, never hand-copied

Status: accepted

## Context

`packages/core-ts` hand-copied the country table, `MAX_AGE` and validation messages from `crates/rust-core`, and the
native auditor screens hard-coded the same table. Fixture parity caught drift only for rows the fixture listed; a new
country added in one place silently disagreed elsewhere. Hand-copied data is also where generated code tends to invent
plausible-looking values.

Compiling `rust-core` to WASM would remove the TypeScript logic too, but adds a wasm build step, async init and wasm
loading in Vitest/jsdom — too much machinery for a hello-world template.

## Decision

Rule **data** (constants, the supported-country table, validation messages) has one definition in `rust-core`.
`pnpm tokens:sync` (`tran-tokens-codegen`, `src/rules_ts.rs`) writes it to `packages/core-ts/src/generated/rules.ts`;
native apps read it through UniFFI. Small TypeScript **functions** over that data stay hand-written and are pinned to
Rust by `fixtures/vote-eligibility.json`.

## Consequences

- Changing a rule: edit the fixture (red) → edit Rust → `pnpm tokens:sync` → green. Never edit `generated/`.
- CI regenerates and fails on `git diff` (existing drift check covers `packages/core-ts/src/generated`).
- Revisit WASM if TypeScript logic grows beyond a few fixture-pinned functions.
