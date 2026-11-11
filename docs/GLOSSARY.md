# Glossary

The project's own words, each with the page that defines it. Alphabetical.

- **Atom** - a token-bound UI building block (`TranText`, `TranButton`, ...); features use atoms, never raw tags or
  inline styles. [ATOMIC.md](./ATOMIC.md), [ADR-0017](./adr/0017-web-atomic-enforcement.md),
  [ADR-0022](./adr/0022-native-atoms.md) (native).
- **Catalogue** - a fixed list defined once in Rust (errors and their presentations, permissions, flags, screens) that
  every platform renders. [ADR-0028](./adr/0028-error-feedback-policy-in-rust.md),
  [PERMISSIONS.md](./PERMISSIONS.md), [REMOTE_CONFIG.md](./REMOTE_CONFIG.md).
- **Conformance** - the check that each platform's accessibility tree shows what the screen contract declares
  (`pnpm screens:check`). [spec 021](./specs/021-screen-contract.md), [ADR-0038](./adr/0038-screen-contract.md).
- **Credential-gated** - code that needs a real account to run: implemented fully, switched off by missing
  configuration, its tests skipped with a `TODO(credentials)` marker. [CREDENTIALS.md](./CREDENTIALS.md),
  [ADR-0046](./adr/0046-credential-gated-code-ships-switched-off.md).
- **Expand, then contract** - the migration order: add the new shape, ship code that uses it, remove the old shape in a
  later release. [PERSISTENCE.md](./PERSISTENCE.md), [ADR-0049](./adr/0049-sqlite-first-forward-only-migrations.md).
- **Fixture parity** - Rust, TypeScript and UniFFI tests all consume one golden file
  (`fixtures/vote-eligibility.json`), so the rules cannot drift. [TESTING.md](./TESTING.md),
  [ADR-0002](./adr/0002-golden-fixtures.md).
- **Flag** - a declared, typed switch with a safe default and an expiry, evaluated on the server; a kill switch is a
  `live` flag. [REMOTE_CONFIG.md](./REMOTE_CONFIG.md), [ADR-0048](./adr/0048-flags-are-declared-and-evaluated-on-the-server.md).
- **Gate** - a check that must pass before work is finished or merged: coverage thresholds, `pnpm test:all`, clippy,
  and the `check:quick` set. [TESTING.md](./TESTING.md), [ADR-0006](./adr/0006-coverage-gate.md).
- **Generated file** - output of `pnpm tokens:sync` or `pnpm uniffi:generate`; never hand-edited, and `cargo test`
  fails while one is stale. [DESIGN.md](./DESIGN.md), [ADR-0030](./adr/0030-generated-files-are-the-snapshots.md).
- **Learning** - an entry in `docs/LEARNINGS.md`: a lesson that changes how the next person works. [LEARNINGS.md](./LEARNINGS.md).
- **Minimum / recommended version** - per platform, the app version below which the API answers `426` (minimum) or the
  app offers an update (recommended). [API_VERSIONING.md](./API_VERSIONING.md), [ADR-0047](./adr/0047-old-clients-keep-working.md).
- **N** - the native clients: SwiftUI (`apps/ios`) and Compose (`apps/android`), not React Native.
  [ADR-0014](./adr/0014-native-swift-kotlin-uniffi.md), [spec 005](./specs/005-native-apps.md).
- **Playbook** - the one short page per topic in `docs/` saying what it is and the rules to follow, paired with a spec
  and an ADR. [ROADMAP.md](./ROADMAP.md) (section 6), [specs README](./specs/README.md).
- **Policy data** - limits and tables kept as Rust data rather than code branches (rate limits, rule tables).
  [RATE_LIMITING.md](./RATE_LIMITING.md), [ADR-0050](./adr/0050-rate-limits-are-policy-data.md).
- **Priming** - explaining what a permission is for, and that it is optional, before the system prompt appears.
  [PERMISSIONS.md](./PERMISSIONS.md), [ADR-0043](./adr/0043-permissions-asked-in-context.md).
- **Requirement (REQ)** - a numbered, testable statement in `docs/specs/`, `[planned]` until a test cites it, then
  `[verified]`; `pnpm spec:check` enforces it. [specs README](./specs/README.md), [ADR-0009](./adr/0009-spec-driven-workflow.md).
- **Rule data** - the tables, limits and messages owned by `crates/rust-core` and delivered to TypeScript only through
  `pnpm tokens:sync`. [ADR-0027](./adr/0027-rule-data-generated-from-rust.md), [ADR-0001](./adr/0001-rust-is-the-source-of-truth.md).
- **Screen contract** - screens, their elements and scenarios declared once in Rust and rendered to Gherkin and JSON
  for web, iOS and Android. [spec 021](./specs/021-screen-contract.md), [ADR-0038](./adr/0038-screen-contract.md).
- **Seam** - an interface a platform API sits behind so an SDK can be swapped in by a fork (sign-in, push, purchases).
  [AGENTS.md](../AGENTS.md), [PUSH.md](./PUSH.md), [ADR-0044](./adr/0044-push-is-a-server-owned-registry.md).
- **SessionVault** - the platform store for a credential (Keychain, Keystore, `HttpOnly` cookie); never Web Storage,
  `UserDefaults` or plain preferences. [SECURITY.md](./SECURITY.md), [ADR-0039](./adr/0039-sessions-tokens-and-secret-storage.md).
- **Signal** - the evidence an unattended agent task reads (exit 0 means nothing to do); no signal, no change.
  [AGENTS.md](../AGENTS.md).
- **Token (design)** - a named colour, spacing or type value defined in `crates/rust-core/src/tokens.rs` and generated
  for TS, CSS, Swift and Kotlin. [DESIGN.md](./DESIGN.md), [ADR-0005](./adr/0005-generated-design-tokens.md).
- **Token (session)** - an opaque, rotating credential stored as a digest on the server. [SECURITY.md](./SECURITY.md).
- **TRAN** - the stack: TanStack web (**T**, today a Vite SPA, see [ADR-0010](./adr/0010-tanstack-start-ssr.md) and
  [ROADMAP.md](./ROADMAP.md)), Rust core (**R**), Axum API (**A**), native mobile (**N**).
  [ARCHITECTURE.md](./ARCHITECTURE.md).
- **UniFFI** - the generator that exposes `crates/tran-uniffi` to Swift and Kotlin for offline voting;
  rerun `pnpm uniffi:generate` after export changes. [ADR-0014](./adr/0014-native-swift-kotlin-uniffi.md),
  [spec 010](./specs/010-ffi-surface.md).
