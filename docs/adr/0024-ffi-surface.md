# ADR-0024 — Treat the UniFFI surface as a public API

**Status:** accepted · **Date:** 2026-10-20 · **Context:** [REQ-FFI-001…004](../specs/010-ffi-surface.md)

## Context

Native developers never see `crates/rust-core`; they see what UniFFI generates into the Swift and Kotlin targets.
That makes docstrings, type names and error shapes part of the product. The first cut of the bridge exposed four
free functions, a single `ValidationError { detail: String }` and an English `reason` string. The apps therefore
pre-validated everything and could not branch on a failure without parsing prose.

At the same time, the generated bindings are checked in so the native IDEs can index them. Checked-in bindings can
silently drift from the Rust crate; the generated checksum only fails at runtime.

## Decision

1. **Documentation is a gate.** `tran-uniffi` denies `missing_docs`; every exported function, record, field, enum and
   variant has a `///` comment. UniFFI copies these into Swift `/** */` and Kotlin KDoc, which powers Quick Help,
   hover and completion without a Rust IDE.
2. **Typed errors and reasons.** `TranValidationError` has one variant per failure the bridge can produce, and
   `TranEligibilityReason` replaces the English `reason` string. The core's `Display` text stays for logs; native
   code maps variants to localized copy and never displays the prose.
3. **No duplicate native models.** The generated record is the single source of truth. Swift adds behaviour with
   `extension VoteEligibilityOfflineResult`; Kotlin uses extension functions (`fun VoteEligibilityOfflineResult.…`)
   that return string-resource IDs. A guard test fails if an app declares a type with a generated name.
4. **Bindings are generated artefacts.** CI rebuilds the cdylib, regenerates both languages and fails on a diff.
   The native suites load the bridge, so a checksum mismatch is a red build rather than a runtime surprise.

## Consequences

- Changing an error variant or record field is a deliberate, compile-visible native break; that is the point.
- The native apps need a small copy-mapping layer; it lives in extensions next to the feature, not in a duplicate
  domain model.
- The bridge remains a thin adapter: validation stays in `rust-core` (`VoteValidationError`), and only the FFI DTOs
  and error translation live in `tran-uniffi`.
- Adding a language-specific package name or a separate Swift framework remains possible later; this ADR only fixes
  the contract, not the packaging.
