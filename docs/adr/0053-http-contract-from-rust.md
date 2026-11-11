# ADR-0053 The HTTP contract is declared once in Rust and rendered like every other contract

**Status:** proposed · **Date:** 2026-11-11 · **Spec:** [034](../specs/034-http-contract.md)

## Context

Rule data, tokens, strings, flags, screens and the compatibility constants all have one definition in `rust-core`,
rendered to each platform by `tran-tokens-codegen` (ADR-0025, ADR-0027, ADR-0038). The HTTP shapes did not. They
existed four times:

- serde structs in `apps/api`, some of them `json!` literals;
- hand-written Zod schemas in `packages/api/src/schemas/`;
- a hand-written request list inside `contract_test.rs`;
- the native decoders.

ADR-0047's checks catch a lot: response snapshots, client replay, and an additive comparison with the last release.
But the comparison infers types from example bodies. It cannot tell a required field from an optional one, and it
cannot see enum values or limits. Nothing makes a new server field appear anywhere else, and a fork gets no
machine-readable description of the API.

## Decision

1. **One declaration.** `crates/rust-core/src/contract/v1.rs` declares every operation as data. Its vocabulary is
   deliberately small:
   - types: `bool`, integer with optional bounds, number, string (optionally non-empty, optionally `uuid`, `date` or
     `date-time`), constant, closed enum (requests), wire enum (responses, from `WIRE_ENUMS`), object, array, map, and
     scalar (`bool | number | string`, for flag values);
   - presence: `required`, `optional`, `nullable`;
   - a shape may be closed (unknown fields rejected).

   It lives in `rust-core` beside `compat.rs` because the codegen crate depends only on `rust-core`. It does not
   reference handlers, so the route table stays where it is, and a test ties the two together.

2. **Rendered, not derived.** `pnpm tokens:sync` writes the Zod schemas (`packages/api/src/generated/contract.ts`) and
   an OpenAPI 3.1 document (`fixtures/contract/v1/openapi.json`). Rust is not generated. The serde structs are held to
   the declaration by the live contract test, which validates every answer of the real router. A field the server
   sends but has not declared fails the test.
3. **Readers stay lenient; the server is strict.** Generated response schemas check JSON type, presence, constants and
   wire enums with their fallback, and ignore unknown fields. Formats and bounds are guarantees the server proves.
   Request schemas enforce everything. The document writes a wire enum as an open string with `x-tran-wire-enum`, so
   clients generated from it inherit the same tolerance.
4. **Native apps are bound through their manifests.** Native apps keep their small hand-written decoders, but every
   field they read must exist in the declaration with that type. A fork whose native apps read whole bodies adds a
   Swift or Kotlin emitter beside `contract_ts.rs`.
5. **The additive check reads the declaration.** `contract:check` compares `openapi.json` with the last release, in
   addition to the existing snapshot comparison.
6. **oRPC stays client-side.** `tranContract` is built from the generated schemas; Axum does not host oRPC.

## Alternatives considered

- **utoipa (OpenAPI from Axum), then generated clients.**
  - Proc-macro derives would go into `rust-core`, which UniFFI also builds, and into `apps/api`.
  - The `json!` handlers would have to become structs.
  - The hand-written `Deserialize` of the eligibility request and its strict date are invisible to a derive, so the
    rules would be repeated in attributes.
  - `#[utoipa::path]` would be a second route list beside the route table.
  - An npm OpenAPI-to-Zod generator cannot express the wire-enum fallback (REQ-VER-008) or the jitless `z`
    (REQ-SEC-024), so its output would be wrapped by hand.
  - The Swift and Kotlin generators produce whole clients that bypass `TranHttp`, the manifests and lenient decoding.
  - We keep its one lasting benefit, the document, by emitting it ourselves.
- **ts-rs or specta.** They give TypeScript types only. There is no runtime schema, so the Zod schemas stay
  hand-written. They do nothing for OpenAPI, Swift, Kotlin or the additive check, and they add derive dependencies to
  `rust-core`.
- **Keep the hand-written types and strengthen the tests.** This is the smallest change, but four copies remain, the
  shape comparison stays an inference from examples, and a fork still has no document.

## Consequences

- **Changing a route** means: edit the declaration, then `pnpm tokens:sync`, then `pnpm contract:snapshots`, then read
  both diffs. Changing a serde struct without the declaration fails the live test; changing the declaration without
  regenerating fails `cargo test`.
- **Hard to reverse:**
  - The vocabulary is what forks learn. Adding a type is easy; removing one is a migration.
  - `openapi.json` becomes part of every release tag the check compares with, so its layout must stay readable by
    future versions of `contract.mjs`.
- **What the template does not do.** It does not generate Swift or Kotlin DTOs, and it does not validate formats on
  the client. Both are recorded here as choices, not omissions.
- **For forks.** The document can feed Swagger UI, Redoc, or a fork's own client generators without the template
  depending on any of them.
