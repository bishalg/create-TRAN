# 021 Screen contract

Scope: one declarative description, in `crates/rust-core`, of what every screen is for, which elements it must offer,
how it behaves and which non-functional rules it meets, generated to the web (`apps/web`), iOS (`apps/ios`) and
Android (`apps/android`) and proven on each by the same scenarios. The contract says **what** and **why**; the
platforms decide **how it looks**. Builds on [005](005-native-apps.md) (native parity and accessibility),
[006](006-navigation-auth-flow.md) (destinations), [008](008-localization.md) (label keys), [011](011-error-feedback.md)
and [018](018-loading-and-offline.md) (presentation and timing policy), [013](013-codegen.md) (generated files are
snapshots). Rationale: [ADR-0038](../adr/0038-screen-contract.md).

Vocabulary used below:

- A **screen** is one destination's user-facing surface: `splash`, `auth_welcome`, `eligibility` (the voter
  dashboard) and `auditor`.
- An **element** is a named part of a screen a person or a test can address: a field, a button, a text, a live
  region, a banner, a toast, a dialog, a segmented control. Its **id** is kebab-case (`check-button`) and is the one
  name used by `data-testid`, `accessibilityIdentifier` and `testTag`.
- A **scenario** is an executable acceptance criterion: a _given_ state, _when_ steps and _then_ expectations, each
  drawn from a closed verb set, bounded by a time limit and citing the requirements it proves.
- The **platform minimums** are the per-platform numbers an element's touch class resolves to (44 pt on iOS, 48 dp on
  Android, 24 CSS px on the web with 44 px for the primary action).

### REQ-SCR-001 [verified] The screen contract is one Rust module

`crates/rust-core/src/screens.rs` (with `screens/`) MUST define every screen (`id`, its `AppDestination`, an `intent` locale key) and its
elements (`id`, semantic `kind`, `label` locale key, `touch` class: `control`, `primary` or `none`, `presence`: always
or only in a named state). An id names one element: a shared element (sign out) is declared once and listed on each
screen. Intent keys are `screen.<camelCaseScreenId>.intent` (camelCase, per [008](008-localization.md)).
Unit tests MUST reject duplicate or non-kebab-case ids, an element whose label key is missing from any locale, and a
screen whose destination no `AppDestination` variant names. The dead-key guard MUST count intent and label keys as
used. `pnpm tokens:sync` MUST emit the contract to `packages/core-ts/src/generated/screens.ts`, iOS
`Generated/ScreenContract.swift` and Android `generated/ScreenContract.kt`; `cargo test` MUST fail while any copy is
stale (ADR-0030).
**Verified by:** `crates/rust-core/src/screens/tests.rs`, `crates/tran-tokens-codegen/src/locales.rs` and
`generate.rs` (a missing contract key fails the run), `crates/tran-tokens-codegen/src/screens_ts.rs` and
`screens_native.rs`, `crates/tran-tokens-codegen/tests/generated_files.rs`, `packages/core-ts/tests/i18n-guards.test.ts`.

### REQ-SCR-002 [verified] Every platform addresses elements by the generated id

Each platform MUST expose every element whose presence is `always` under its contract id, and every element with a
conditional presence whenever its state holds, through `data-testid` (web), `accessibilityIdentifier` (iOS) and
`testTag` (Android), referencing the generated constant and never a string literal. A guard test MUST fail on a
literal element id in feature code or tests, on an id a platform uses that the contract does not declare, and on an
always-present element a platform never references.
**Verified by:** `packages/core-ts/tests/screen-ids.test.ts` (scans `apps/web/src`, `apps/ios`, `apps/android` and
`e2e/`; Maestro YAML stays literal and is checked against the contract). Always-present elements a platform does not
implement yet are listed there with a reason (`KNOWN_GAPS`), and the guard fails once a gap is closed.

### REQ-SCR-003 [verified] The contract never describes presentation

An element kind MUST be semantic (`field`, `button`, `text`, `live_region`, `banner`, `toast`, `dialog`,
`segmented`, `progress`). The contract MUST NOT carry colour, size, spacing, typography, order or layout; a test over
the generated JSON MUST fail if any key named like one appears. Presentation stays with design tokens
([ADR-0005](../adr/0005-generated-design-tokens.md)) and each platform's atoms ([ADR-0022](../adr/0022-native-atoms.md)).
**Verified by:** `crates/rust-core/src/screens/tests.rs` (`the_contract_never_describes_presentation`).

### REQ-SCR-004 [verified] Acceptance criteria are scenario data with a closed verb set

Scenarios MUST live beside their screen in `screens.rs` (`screens/scenarios.rs`). _Given_ MUST be drawn from: stored session, API reachable or
unreachable, locale, theme, largest text scale, reduced motion. _When_ MUST be drawn from: `tap`, `type`, `select`,
`press_key`, `go_offline`, `go_online`. _Then_ MUST be drawn from: `exists`, `missing`, `text_is` (a locale key with
arguments, resolved per locale), `has_focus`, `announced` (the live region's text), `count`. Every scenario MUST cite
at least one requirement id and MUST carry `within_ms`, defaulting to the indicator delay plus `SERVER_DEADLINE_MS`
and never exceeding it. A test MUST pin the verb list so that adding a verb changes a named snapshot and the ADR.
**Verified by:** `crates/rust-core/src/screens/tests.rs` (citations resolve, bounds hold, verb snapshot
`the_verb_set_is_closed`, expected messages resolve with their arguments, eligibility verdicts agree with the rules).

### REQ-SCR-005 [planned] Scenarios render to Gherkin and to machine-readable JSON

`pnpm tokens:sync` MUST render every scenario to `e2e/features/screens/<screen>.feature` with `@REQ-…` tags and a
header naming the generator, to `packages/core-ts/src/generated/screens.ts` (typed scenario data for Playwright) and
to a JSON resource each native test bundle loads (`apps/ios/Tests/.../Resources/screens.json`,
`apps/android/app/src/androidTest/assets/screens.json`). Hand-editing a rendered file MUST fail `cargo test`.
`pnpm spec:check` MUST accept the generated Gherkin as the citing test for the requirements it tags.
**Verified by:** `crates/tran-tokens-codegen/tests/generated_files.rs`, `tooling/spec-check/spec-check.test.mjs`.

### REQ-SCR-006 [planned] One scenario interpreter per platform runs every scenario

Playwright step definitions bound to the generated Gherkin, an XCUITest case and a Compose instrumentation case MUST
each execute every scenario by interpreting its verbs over element ids, with no per-scenario code. A failing step MUST
report the scenario name, the step and the element. Each interpreter MUST resolve `text_is` through the shared
dictionaries for the scenario's locale ([008](008-localization.md)), never through hard-coded copy.
**Verified by:** `e2e/steps/screens.steps.ts`, `ScreenContractUITests.swift`, `ScreenContractTest.kt`, each citing
the scenario tags it runs.

### REQ-SCR-007 [planned] Non-functional rules come from the element's declaration

The platform minimums MUST be one Rust table (`PLATFORM_MINIMUMS`) emitted with the contract. For every element of
touch class `control` each interpreter MUST assert the platform minimum; for every `live_region` it MUST assert the
platform's announcement mechanism (`role="status"`, `.updatesFrequently` or announcement, `LiveRegionMode.Polite`);
for a scenario given the largest text scale it MUST assert every always-present element stays reachable. Numbers MUST
NOT appear in platform test code.
**Verified by:** the three interpreters (REQ-SCR-006) and `crates/rust-core/src/screens/tests.rs`
(`platform_minimums_are_one_table`, the Rust half).

### REQ-SCR-008 [planned] A conformance manifest is checked against the contract

Each platform's UI suite MUST write, per screen and reachable state, the accessibility tree it presents (id, role,
accessible name, frame) to a local, gitignored manifest. `pnpm screens:check` MUST compare every manifest found with
the contract and fail when a required element is absent, carries another role or name than the contract's kind and
label resolve to, is below its touch minimum, or when an interactive element is present that the contract does not
declare. The checker MUST report every difference in one run.
**Verified by:** `tooling/screens-check/screens-check.test.mjs` with staged manifests (a passing one, each failure
class), and the nightly native workflow running the real suites ([009](009-native-tests-in-ci.md)).

### REQ-SCR-009 [planned] A journey is written once

A hand-written UI journey (XCUITest, Compose test, Maestro flow or Playwright step) that a scenario covers MUST be
removed in the change that adds the scenario; what remains MUST be behaviour the verb set cannot express, named as
such in `docs/TESTING.md`. New user-visible behaviour MUST start as a scenario in `screens.rs`.
**Verified by:** review, and `docs/TESTING.md` listing the remaining hand-written suites with their reason.
