# ADR-0026 — Emit Google DESIGN.md from rust-core tokens

Status: accepted

## Context

Google Labs open-sourced [DESIGN.md](https://github.com/google-labs-code/design.md) as an
agent- and Stitch-friendly design contract (YAML tokens + markdown rationale). Teams expect a
root `DESIGN.md` they can upload or point agents at. TRAN already owns brand values in
`crates/rust-core/src/tokens.rs` ([ADR-0005](0005-generated-design-tokens.md)).

Hand-maintaining DESIGN.md beside Rust would create a second source of truth.

## Decision

1. **`pnpm tokens:sync` generates repo-root `DESIGN.md`** (path configurable in
   `tooling/design-tokens/codegen.json` as `design_md_path`) from `tokens_json_snapshot()`.
2. **Rust remains normative.** Do not edit `DESIGN.md` by hand; regenerate after token changes.
3. **`docs/DESIGN.md` stays the human pipeline playbook** (how to change tokens), distinct from
   the generated Google-format file.

## Consequences

- Agents and Stitch see the same palette/spacing/type as CSS, Swift, and Kotlin.
- CI / local drift follows the same `tokens:sync` habit as other generated artifacts.
- Fluid CSS values (e.g. `clamp()` display size) are projected to a concrete rem step in DESIGN.md
  typography so the file stays schema-valid.
