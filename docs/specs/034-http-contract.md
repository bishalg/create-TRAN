# 034 HTTP contract

Scope: how the request and response shapes of the Axum API (`apps/api`) are declared once, in Rust, and reach every
client: the TypeScript schemas the web and `@tran/core` read with (`packages/api`), the OpenAPI document a fork can
publish or generate from, and the manifests of the iOS and Android apps (`apps/ios`, `apps/android`). It also covers
how the running server is held to that declaration. Builds on [002](002-http-api.md) (routes, envelope, REQ-API-011),
[013](013-codegen.md) (codegen, drift), [021](021-screen-contract.md) (declared data, rendered per platform) and
[028](028-api-versioning.md) (snapshots, replay, additive changes). Rationale:
[ADR-0053](../adr/0053-http-contract-from-rust.md). Reference: [`../API.md`](../API.md).

Vocabulary used below:

- The **declaration** is `rust_core::contract::V1` (`crates/rust-core/src/contract/v1.rs`): one **operation** per
  route (method, path template, path parameters, authentication, request headers, request shape, responses), built
  from **shapes** (named objects of **fields**). A field has a type, a **presence** (`required`, `optional`: may be
  absent, `nullable`: always present, may be `null`) and a doc line.
- A **wire enum** is a response string with known values and a fallback (`WIRE_ENUMS`, REQ-VER-008). A **closed
  enum** is a request string that only takes the listed values.
- The **live contract test** runs the real router (`build_app`, every middleware) in-process and calls real routes.
- **Generated contract files** are `packages/api/src/generated/contract.ts` and `fixtures/contract/v1/openapi.json`,
  written by `pnpm tokens:sync`.
- `fixtures/vote-eligibility.json` pins business rules (spec 001); it is not part of the HTTP contract.

## The declaration

### REQ-CON-001 [planned] Every route is declared exactly once

Every route of the route table (`apps/api/src/routes/table.rs`) and `GET /api/health` MUST have exactly one operation
in the declaration with the same method and path template, and the declaration MUST have no operation the router does
not serve.
**Verified by:** `apps/api/tests/contract_test.rs` (`every_route_is_declared_once`).

### REQ-CON-002 [planned] The declaration is well formed

A test MUST fail when, in the declaration:

- two shapes share a name;
- two operations share a method and path;
- a path parameter in a template is undeclared, or a declared one is not in the template;
- a closed enum appears in a response shape;
- a wire enum appears in a request shape, or is not one of `WIRE_ENUMS`;
- an operation declares no `2xx` response;
- an integer's minimum is above its maximum.

Rule data a field depends on (the age limit, the role values) MUST be read from its `rust-core` constant, never
repeated as a literal.
**Verified by:** `crates/rust-core/src/contract/tests.rs`.

## Generated files

### REQ-CON-003 [planned] TypeScript reads with generated schemas only

`pnpm tokens:sync` MUST write `packages/api/src/generated/contract.ts` with one Zod schema and one inferred type per
shape (`<Name>Schema`, `<Name>`), importing `z` from `schemas/zod.ts`. Response schemas MUST:

- ignore unknown fields;
- read a wire enum through `wireEnum` (unknown value → fallback);
- read a `nullable` field as `null` or absent;
- check JSON type, presence, constants and non-empty strings, but not formats or numeric bounds, which are server
  guarantees (REQ-CON-006).

Request schemas MUST also enforce closed enums, formats and integer bounds. No `z.object(` may appear in
`packages/api/src` outside `generated/`. The lenient error envelope (REQ-ERR-004) is derived from the generated one,
not rewritten.
**Verified by:** `crates/tran-tokens-codegen/src/contract_ts.rs` unit tests;
`packages/api/tests/contract-guard.test.ts`.

### REQ-CON-004 [planned] An OpenAPI 3.1 document is generated from the declaration

`pnpm tokens:sync` MUST write `fixtures/contract/v1/openapi.json`: OpenAPI `3.1.0`, `info.version` the API version
(`1`), never the product version. It MUST contain:

- every operation, with its path parameters, request headers and request body;
- authentication as a security scheme;
- every declared response;
- the error envelope as each operation's `default` response;
- every shape under `components.schemas`.

A wire enum MUST be written as a plain `string` with `x-tran-wire-enum: { values, fallback }`, never as a closed
`enum`, so a client generated from the document does not break on a new value. Every `$ref` MUST resolve, and the
file MUST be stable byte for byte across runs.
**Verified by:** `crates/tran-tokens-codegen/src/openapi.rs` unit tests; `tooling/contract/contract.test.mjs`.

### REQ-CON-005 [planned] A stale generated contract fails `cargo test`

Both generated contract files MUST be part of `generate()`, so `cargo test` fails, naming the file, while either one
differs from what the declaration renders (ADR-0030), and fixing it is `pnpm tokens:sync`. Neither file may be edited
by hand.
**Verified by:** `crates/tran-tokens-codegen/tests/generated_files.rs`; `generate.rs`
(`the_contract_files_are_part_of_the_run`).

## The server is held to it

### REQ-CON-006 [planned] Every live answer matches its declared shape

The live contract test MUST validate, against the declaration, the body of every answer to every case in
`contract_test.rs`:

- a `2xx` against the shape declared for that operation and status, or no body when it declares none;
- any other status against the error envelope.

It MUST fail, naming the case, route, status and dotted field path (`user.role`, `components[1].name`), on any of
these:

- a field the shape does not declare;
- a missing required field;
- a wrong JSON type;
- an integer that is not whole or is outside its bounds;
- a string not of its declared format (`uuid`, `date`, `date-time`);
- an empty string declared non-empty;
- a constant of another value;
- a wire-enum value not in the declaration;
- a status the operation does not declare.

**Verified by:** `apps/api/tests/contract_test.rs` (`every_answer_matches_its_declared_shape`); the recorded answers
are also validated offline by `crates/rust-core/src/contract/tests.rs`.

### REQ-CON-007 [planned] Every declared success is exercised

For every operation and every `2xx` status it declares, the live contract test MUST have at least one case that
answers with it, so no declared success shape goes unchecked.
**Verified by:** `apps/api/tests/contract_test.rs` (`every_declared_success_is_exercised`).

### REQ-CON-008 [planned] Declared requests are what the server accepts

`fixtures/contract/v1/requests.json` MUST be rendered from the declaration (same format as today). Against the live
router, for every operation with a request shape:

| Request                                             | Expected answer |
| :-------------------------------------------------- | :-------------- |
| a valid body                                        | not `400`       |
| a body without an optional field                    | not `400`       |
| without a required field                            | `400`           |
| a field of the wrong type                           | `400`           |
| a closed-enum value outside its list                | `400`           |
| an integer one past each declared bound             | `400`           |
| a string not of its declared format                 | `400`           |
| an unknown field, when the shape is declared closed | `400`           |

Also, every operation declaring bearer authentication MUST answer `401` without `Authorization`.
**Verified by:** `apps/api/tests/contract_test.rs` (`the_declared_requests_match_what_the_server_accepts`).

## The clients are held to it

### REQ-CON-009 [planned] Recorded answers parse with the generated schemas

Every answer in `fixtures/contract/v1/responses.json` MUST parse with the generated schema for its route and status
(the envelope for a failure, nothing for `204`). For every shape, the Zod schema's required keys MUST equal the
`required` list of the same schema in `openapi.json`, so the two renderers cannot disagree.
**Verified by:** `packages/api/tests/contract-snapshots.test.ts`.

### REQ-CON-010 [planned] A client reads only declared fields

For every client manifest in `fixtures/contract/clients/` (current and released), every `reads` path MUST name a field
the declaration has for that route and status, with the declared JSON type (`null` also allowed for a nullable
field). Native decoders read only their manifest's fields (REQ-VER-003); they are not generated.
**Verified by:** `apps/api/tests/contract_reads_test.rs`.

### REQ-CON-011 [planned] The additive check compares declared schemas

`pnpm contract:check` MUST also compare `openapi.json` with the same file at the last release tag (none there: it
says so and skips that file). It MUST fail on any of these:

- **Operations:** an operation removed; authentication added to an operation.
- **Request headers:** a header added as required, or made required.
- **Request fields:** a field removed, added as required, or made required; a type changed; a closed-enum value
  removed; a bound narrowed; a format added or changed; a shape made closed.
- **Response fields:** a field removed; a required field made optional or nullable; a type, format or constant
  changed.

It MUST NOT fail on additive changes: a new operation, a new optional request field or header, a new response field,
a new status, or a new wire-enum value.
**Verified by:** `tooling/contract/contract.test.mjs`.

### REQ-CON-012 [planned] The oRPC contract is client-side and generated-schema based

`tranContract` (`packages/api/src/contract.ts`) MUST use the generated request and response schemas. No oRPC server
runs in `apps/api`; Axum serves REST and the declaration is the only server-side contract.
**Verified by:** `packages/api/tests/api-contract.test.ts`.
