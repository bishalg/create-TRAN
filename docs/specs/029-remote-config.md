# 029 Feature flags and remote configuration

Scope: how the Axum API (`apps/api`) tells each app version what is switched on, so a feature can ship inside a
binary turned off and be turned on later without a release, and turned off again at once if it misbehaves; how flags
are declared, evaluated, cached and removed; and how the web app (`apps/web`), iOS (`apps/ios`) and Android
(`apps/android`) use them. The worked example is the "Notify me" reminder (spec 027). Builds on
[028](028-api-versioning.md) (the client header, minimum and recommended versions). Rationale:
[ADR-0048](../adr/0048-flags-are-declared-and-evaluated-on-the-server.md). Playbook:
[`../REMOTE_CONFIG.md`](../REMOTE_CONFIG.md).

Vocabulary used below:

- A **flag** is a named, typed value the app reads to decide behaviour. Its **default** is compiled into the app and is
  what the app does when it has never reached the server.
- A **rule** narrows a flag's value by platform, minimum client version and rollout percentage.
- **Ship dark**: release the code with its flag off. **Kill switch**: a flag whose only purpose is to turn a released
  feature off quickly.
- The **bucket** is a number from 0 to 99 the device derives once from its installation id; it lets a rollout reach
  the same people each time without the server learning who they are.

### REQ-CFG-001 [verified] Flags are declared once, in Rust

`crates/rust-core/src/flags.rs` MUST declare every flag: id, type (boolean, integer or a closed set of strings), safe
default, whether it is `live` (applied as soon as fetched) or read at launch, owner, purpose and an expiry date. The
catalogue MUST be generated to TypeScript, Swift and Kotlin as typed accessors; no client may read a flag by a string
it spells itself.
**Verified by:** `flags.rs` unit tests, `fixtures/flags.json` on every platform, a source guard.

### REQ-CFG-002 [verified] One public route returns the configuration for the caller

`GET /api/v1/config` MUST answer `200` with `{ "config_version", "flags": { … }, "client": { "minimum_version",
"recommended_version" } }`, evaluated for the platform and version in `X-Tran-Client` (REQ-VER-004) and the bucket in
`X-Tran-Bucket`; a missing bucket or one outside `0..=99` is outside every rollout below 100. It needs no session,
carries an `ETag`, `Cache-Control: private, no-cache` and `Vary` on the client and bucket headers, answers `304` to a
matching `If-None-Match`, is reachable cross-origin (CORS allows `X-Tran-Bucket` and `If-None-Match` and exposes
`ETag`), and is exempt from the `426` of REQ-VER-005 so an outdated app can still learn that it must update. It is
rate limited as a `read` route (spec 031). Every declared flag MUST be
present in the answer; a flag the caller's rules do not match takes its default.
**Verified by:** `apps/api/tests/config_test.rs`.

### REQ-CFG-003 [verified] Evaluation is one pure Rust function

`evaluate(flag, rules, client)` MUST be defined once and pinned by `fixtures/flags.json`: the first rule whose
platform, minimum version and rollout range all match gives the value; no match gives the default; a value of the
wrong type gives the default. Rollout MUST be stable (bucket below the percentage) so raising a percentage only adds
people.
**Verified by:** `crates/rust-core/tests/flag_fixtures.rs`, `crates/tran-uniffi/tests/flag_fixtures.rs`. The
server evaluates; TypeScript keeps no copy of `evaluate`.

### REQ-CFG-004 [verified] Rules come from a source that can change without a deploy

Rules MUST be read through a `ConfigSource` trait. The sample's source is a JSON file named by `REMOTE_CONFIG_PATH`,
re-read when its content changes (whatever its timestamp); with no file configured, or the file removed, every flag
is its default. A file that cannot be read or does not parse MUST be reported once in the log and ignored, leaving the
last good rules in force; a rule naming an unknown flag MUST be reported once and dropped on its own, the other rules
of the file applying. `config_version` is derived from the file's content (`1` with no file), so replicas and
restarts serving one file agree. A change MUST reach callers within `CONFIG_POLICY.max_age_seconds` (`300`).
`api check-config` MUST fail when the variable is set and the file is missing or does not parse.
**Verified by:** `config_test.rs` on the injected clock, `config_source.rs` unit tests, `check_config_test.rs`.

### REQ-CFG-005 [verified] The app never waits for configuration

Each client MUST start with compiled defaults or the last configuration it stored, fetch in the background at launch
and on return to the foreground (with `If-None-Match`), and store the answer. No screen may block on the fetch, and a
failed fetch MUST leave the stored configuration in use and show nothing. A flag read at launch keeps its value for
the whole run; a `live` flag changes as soon as a fetch brings a new value.
**Verified by:** `packages/core-ts/tests/remote-config.test.ts`, `RemoteConfigTests.swift`, `RemoteConfigTest.kt`.

### REQ-CFG-006 [verified] The bucket is derived on the device and reveals nothing

The bucket MUST be computed by one Rust function from the installation id (REQ-PSH-010; the web creates its own random
id in local storage for this purpose only) and sent as `X-Tran-Bucket`. The installation id itself MUST NOT be sent to
the config route.
**Verified by:** the fixture on every platform; the remote-config client tests.

### REQ-CFG-007 [verified] The reminder ships dark and has a kill switch

`notify_me` MUST be a boolean, `live` flag whose default is `false`. `notify-me-button` (REQ-PSH-008) MUST be shown
only when the flag is `true`, push is available and the verdict is "not yet eligible". Turning the flag off in the
source MUST hide the control on the next fetch without a release.
**Verified by:** the platform tests; scenario "The reminder stays hidden until it is switched on".

### REQ-CFG-008 [verified] Configuration carries the client thresholds

The `client` object MUST carry the same minimum and recommended versions as REQ-VER-005 and REQ-VER-006 for the
caller's platform. A client MUST act on them exactly as on the `426` and the header (blocking screen, dismissible
prompt), so an app learns it is outdated at launch, before its first product call.
**Verified by:** `config_test.rs`; the platform tests.

### REQ-CFG-009 [verified] Stale flags fail a check

`pnpm flags:check` MUST fail when a flag is past its expiry date, when a declared flag is read by no client, and when
a rule file in the repo names a flag that is not declared. A flag whose feature is fully released is removed, with the
code path it guarded.
**Verified by:** `tooling/flags/flags.test.mjs`.

### REQ-CFG-010 [verified] Configuration is public and holds no secret

The config route is readable by anyone, so a flag MUST NOT hold a secret, a credential or personal data, and a flag
MUST NOT be the only thing protecting a paid or private feature: the API enforces access on its own routes. A guard
MUST fail on a flag whose name looks like a secret (REQ-SEC-003's rule).
**Verified by:** `flags.rs` unit tests, `tooling/flags/flags.test.mjs`.
