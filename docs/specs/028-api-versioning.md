# 028 API versioning and client compatibility

Scope: how one Axum API (`apps/api`) serves several released versions of the web app (`apps/web`), the iOS app
(`apps/ios`) and the Android app (`apps/android`) at once, when each store approves on its own schedule and people
update when they choose: what may change in the API, how a client says which version it is, how old clients keep
working, and how a client too old to support is told to update. Builds on [002](002-http-api.md) (routes, envelope),
[011](011-error-feedback.md) (codes and presentations), [017](017-release.md) (one version) and
[021](021-screen-contract.md). Rationale: [ADR-0047](../adr/0047-old-clients-keep-working.md). Playbook:
[`../API_VERSIONING.md`](../API_VERSIONING.md).

Vocabulary used below:

- The **API version** is the number in the path (`/api/v1`). It changes only for a breaking change.
- The **client version** is the app's product version (ADR-0034), per platform.
- An **additive** change adds an optional request field, a response field, a route or an enum value clients are
  prepared for. Everything else (removing, renaming, retyping, a new required field, a changed meaning) is
  **breaking**.
- The **minimum** version is the oldest client the API still serves; the **recommended** version is the one below
  which the app suggests an update.

## The server

### REQ-VER-001 [verified] Product routes live under a versioned path

Every product route MUST be served under `/api/v1/…`. The health routes stay unversioned (`/api/health…`), because
infrastructure, not an app release, calls them. The base path MUST be one Rust constant, generated to TypeScript,
Swift and Kotlin; no client may spell a route's version by hand. An unknown version (`/api/v9/…`) answers `404` in the
envelope.
**Verified by:** `apps/api/tests/versioning_test.rs`; a source guard on the clients
(`packages/core-ts/tests/versioning-guards.test.ts` for the web and TypeScript; the iOS and Android sources join it).
The generated constants are `API_BASE_PATH` in `@tran/api` and `ApiContract.basePath` in Swift and Kotlin.

### REQ-VER-002 [verified] Within a version, changes are additive, and a check proves it

Real responses of every route MUST be recorded as normalised snapshots in `fixtures/contract/v1/` (this implements
REQ-API-011): `routes.json`, `requests.json` (each body's fields, type and whether required, proven against the
router) and `responses.json` (successes and representative errors; ids, times, tokens and versions normalised).
The test fails when regenerating would change them; `pnpm contract:snapshots` rewrites them after an additive
change. `pnpm contract:check` MUST compare the current responses and request schemas with the snapshot of the
last released version (the last `v*` tag; before the first release there is nothing to compare, and it says so) and
fail on a removed or renamed field, a changed type, a new required request field, a removed request field or a
removed route. A deliberate break MUST be made under a new API version, never by updating the snapshot.
**Verified by:** `apps/api/tests/contract_test.rs`, `tooling/contract/contract.test.mjs`,
`packages/api/tests/contract-snapshots.test.ts`.

### REQ-VER-003 [verified] Released clients are replayed against today's server

For each released client version, the requests that client makes MUST be kept in `fixtures/contract/clients/` (written
by `pnpm release`). Each platform keeps `fixtures/contract/clients/<platform>/current.json` (method, path, the
`X-Tran-Client` header, body, expected status and the response fields it reads, by type), maintained by hand and
checked against that platform's client code by a test so it cannot drift; `pnpm release` copies it to
`<version>.json`, and `pnpm release:check` fails while the current version of a platform with a manifest is not
recorded. A test MUST replay every kept request against the current router and require the response shape that
client was built to read. A client version is dropped from the replay only when it is below the minimum.
**Verified by:** `apps/api/tests/client_replay_test.rs`, `packages/core-ts/tests/client-manifest.test.ts` (web),
`ClientManifestTest.kt` (Android), `tooling/release/release.test.mjs`.

### REQ-VER-004 [verified] Every client says who it is

Each request from an app MUST carry `X-Tran-Client: <platform>/<version>` (`ios/1.4.0`, `android/1.4.0`, `web/1.4.0`).
Parsing MUST be one Rust function, pinned by `fixtures/compat.json`: a missing or malformed header is `unknown`, never
an error. The parsed platform and version MUST appear in the access log as bounded fields (`client_platform`,
`client_version`, `-` without a version). Preflight MUST permit the header.
**Verified by:** `crates/rust-core/tests/compat_fixtures.rs`, `versioning_test.rs`,
`packages/core-ts/tests/compat.test.ts`, `apps/web/src/app/App.versioning.test.tsx`.

### REQ-VER-005 [verified] A client below the minimum is told to update, on every product route

Minimum and recommended versions per platform MUST come from configuration (`CLIENT_MIN_VERSION_IOS`, …; unset means
no minimum). A request whose client version is below its platform's minimum MUST answer `426` with code
`client.upgrade_required` in the envelope, before any handler runs. An `unknown` client is served. Version comparison
MUST be one Rust function (numeric by part; a pre-release suffix is ignored), pinned by the fixture. A threshold that
is not a version MUST stop start-up, naming the variable. Health is exempt, and the layer keeps an explicit list of
product routes exempt from the `426` (empty today; spec 029's configuration route joins it).
**Verified by:** `versioning_test.rs`, the fixture.

### REQ-VER-006 [verified] A client below the recommended version is nudged, not blocked

A response to a client at or above the minimum and below the recommended version MUST carry
`X-Tran-Update: recommended` and `X-Tran-Recommended-Version: <version>`, so the app can remember a dismissal per
recommended version (REQ-VER-010). Browsers may read both (CORS `expose-headers`). Nothing else about the response
changes.
**Verified by:** `versioning_test.rs`.

### REQ-VER-007 [verified] Deprecation is announced before removal

A route or API version marked deprecated in the Rust route table (`apps/api/src/routes/table.rs`) MUST answer with
`Deprecation` (RFC 9745, `@<seconds since the epoch>`) and `Sunset` (RFC 8594, an HTTP-date) headers and log one
`info` event, `deprecated route called`, per request with the client's platform and version. No route is deprecated in
the sample; a test-only route table proves the mechanism. A deprecated route MUST have a sunset
date; a test MUST fail when a route is removed while the minimum version of any platform is still a client that calls
it (known from REQ-VER-003).
**Verified by:** `versioning_test.rs`, `client_replay_test.rs`.

## The clients

### REQ-VER-008 [verified] Clients read tolerantly

Every client MUST ignore response fields it does not know, and MUST map an enum value it does not know to the fallback
the Rust catalogue declares for that enum (`WIRE_ENUMS` in `compat.rs`: `user_role` reads as `citizen_voter`,
`country_source` as `default`; an unknown error code is already classified by its HTTP status, REQ-ERR-004).
`fixtures/compat.json` holds "responses from the future" for every route; each platform MUST decode all of them.
**Verified by:** `packages/api/tests/compat.test.ts`, `CompatTests.swift`, `CompatTest.kt`.

### REQ-VER-009 [verified] An unsupported client shows a blocking update screen

`client.upgrade_required` MUST have the `screen` presentation in the catalogue: a full-screen "Update required"
with one action that opens the platform's store page (a reload on the web), declared in the screen contract (state
`update_required`, element `update-button`, staged by the `upgrade_required` given). It replaces whatever was on
screen, cannot be dismissed, and MUST NOT sign the user out or clear the vault.
**Verified by:** the platform feedback tests; scenario "An unsupported version is asked to update".

### REQ-VER-010 [verified] A recommended update is offered once per version

`update_prompt(state)` MUST be one Rust decision, pinned by the fixture: on `X-Tran-Update: recommended`, show a
dismissible prompt (the catalogue's `update_recommended` action: "Update", "Not now") unless one was already dismissed
for this recommended version. Dismissing MUST NOT be remembered across recommended versions. The dismissed version
is a preference, never a credential (the web keeps it in Web Storage).
**Verified by:** the fixture on every platform; the platform feedback tests.

### REQ-VER-011 [verified] The store address is configuration with placeholders

The store page each platform opens MUST come from the app's build configuration, with a placeholder default
(`https://tran.example/…`), listed in `.env.example` (REQ-MOB-004).
**Verified by:** `tooling/mobile-release/mobile-release.test.mjs`.
