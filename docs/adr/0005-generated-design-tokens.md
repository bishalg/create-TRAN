# ADR-0005 Design tokens are generated

Status: accepted

## Context

Hand-copied colours diverge across web, iOS and Android.

## Decision

One tokens source feeds `crates/tran-tokens-codegen`, which emits TS, CSS, Swift and Kotlin. Components use tokens only.

## Consequences

CI fails on generated-file drift. Generated files are excluded from formatting and coverage.

Placement and retargeting (keep the binary in this monorepo; destinations in
`tooling/design-tokens/codegen.json`) are covered by [ADR-0025](0025-tokens-codegen-stays-in-repo.md).
Google-format root [`DESIGN.md`](../../DESIGN.md) for agents / Stitch is emitted by the same
pipeline ([ADR-0026](0026-design-md-from-rust.md)).
