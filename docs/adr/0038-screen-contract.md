# ADR-0038 The screen is a declared contract in Rust, and the platforms are checked against it

**Status:** accepted · **Date:** 2026-11-09 · **Accepted:** 2026-11-10 · **Spec:** [021](../specs/021-screen-contract.md)

## Context

Rust already owns every policy below the screen and generates it to TypeScript, Swift and Kotlin: eligibility rules
(ADR-0001, ADR-0027), design tokens (ADR-0005), the theme registry (ADR-0018), navigation destinations (ADR-0015), the
error and feedback presentation (ADR-0028) and the waiting policy (ADR-0035). Nothing owns the screen. The element
names `age-field`, `check-button`, `offline-result`, `api-status` and `offline-notice` are string literals repeated in
XCUITest, the Compose test, the Playwright steps and the Maestro flows; they are the de facto view contract and are
typed nowhere. The same journey ("a device verdict survives an unreachable API") is hand-written four times, in four
dialects, and nothing proves the four say the same thing or that a new screen on one platform has a counterpart on the
others. Specs state the requirements in prose; the link from a requirement to the element it concerns is a reviewer's
memory.

Expo's [Exact](https://github.com/expo/exact) solves this by making the view itself a compiled artifact: one
declarative source becomes the UI on every host, and one test file runs unchanged everywhere. That trades away the
hand-written, platform-idiomatic SwiftUI and Compose that this template exists to demonstrate (ADR-0014, ADR-0022). The
lesson worth keeping is narrower: the **intent, elements and acceptance criteria** of a screen can be one declaration
and one test, even when the pixels are not.

## Decision

1. **The screen contract is Rust data.** `crates/rust-core/src/screens.rs` declares each screen's identity (id,
   destination, an intent locale key), its elements (id, semantic kind, label key, touch class, presence) and its
   scenarios. It is generated to every platform by `pnpm tokens:sync` like every other table, and the committed
   outputs are its snapshots (ADR-0030).
2. **It says what and why, never how it looks.** Element kinds are semantic. No colour, size, spacing, type, order or
   layout can be expressed, by construction and by a test over the generated JSON. SwiftUI, Compose and the web stay
   free to be visually different; the contract is what they must have in common.
3. **Acceptance criteria are scenarios with a closed verb set.** Given, when and then verbs are an enum. The set is
   pinned by a snapshot test; a new verb is an ADR, not a pull request. Every scenario cites requirement ids and
   carries a time bound derived from the feedback policy, which makes each one Specific, Measurable, Achievable,
   Relevant and Time-bound by construction rather than by review.
4. **Gherkin is rendered, not written.** Scenarios render to `e2e/features/screens/*.feature` for people and to JSON
   for machines. ADR-0007 keeps BDD as the acceptance layer; the authored form moves from the feature file to the Rust
   scenario for cross-platform screens. Web-only behaviour (theme before first paint, skip links) stays hand-written
   Gherkin.
5. **One interpreter per platform.** Playwright, XCUITest and Compose each get a small executor over the verb set and
   element ids. Hand-written journeys a scenario covers are deleted, not kept alongside.
6. **The contract is the conformance oracle.** Each UI suite dumps the accessibility tree per screen and state; a
   checker diffs it against the contract (presence, role, accessible name, touch minimum, no undeclared interactive
   elements). Exact uses Chrome as its layout oracle; here the oracle is the declaration, because layout is allowed to
   differ.

### How the oracle reads a platform (added on acceptance, REQ-SCR-008)

- **Every platform is read in its own vocabulary.** The manifests keep the platform's roles (ARIA, `XCUIElement`
  types, Compose roles); the checker holds one kind-to-role table per platform. The contract stays semantic.
- **A deliberate difference is declared, not tolerated.** An element only one platform offers carries the platforms
  that offer it (`Element::only`) and the reason beside it; the checker then neither requires it elsewhere nor accepts
  it there. The first real run found the web's skip link, language picker and check-mode switch, all required by web
  specs, and declared them; it found the web's auditor "Switch to Citizen Voter" button and its theme picker and API
  status outside the voter dashboard, which nothing required, and removed them from the web.
- **Content is named by its label.** A text or live region whose content changes (the verdict, the API status, the
  role) is announced as its label and then its content: `aria-label` or a screen-reader-only prefix on the web,
  `accessibilityLabel` plus `accessibilityValue` on iOS, a content description of label and text on Android.
- **An unreachable state is a listed gap.** A conditional element whose state no scenario reaches would fail "never
  observed" on every platform. When the closed verb set cannot reach it (the toast follows a server answer, and the
  web's device check never asks the server), the state is listed with its reason in `UNREACHED_STATES`, as
  `KNOWN_GAPS` lists ids a platform lacks; a test fails once a scenario reaches it, so the entry goes.
- **A scenario follows its elements.** A scenario runs on the platforms that offer every element it names and can
  stage every given (`scenario_platforms`). The location scenarios of spec 026 name native-only elements, so the web's
  Gherkin leaves them out and `screens.json` lists `["ios", "android"]` for them.
- **One given was added for permissions (spec 026, ADR-0043):** `permission`, the status a permission reports
  (`Given the permission "location_approximate" is "denied_permanently"`; in `screens.json`
  `{ "verb": "permission", "permission": "location_approximate", "value": "denied_permanently" }`). It is native only:
  each interpreter stages it through a debug-only launch preset that sets the app's fake permission gateway, so no
  scenario ever reaches a system prompt. Without the given, the fake gateway reports `not_determined`.
- **Platform-owned controls are an allowlist in the checker,** each with its reason: today only the iOS keyboard and
  a navigation bar back button.

## Alternatives considered

- **Adopt a declarative UI language and generate the views** (Exact's Contract, or a Rust UI toolkit). Rejected: it
  removes the hand-written native UI the template teaches, is pre-1.0 upstream, and would make the design-token and
  atom layers redundant.
- **Keep Gherkin as the source and parse it in Rust.** Rejected: free text is not a closed set, so the interpreters
  would grow with every phrasing, and nothing would tie a step to an element id or a locale key.
- **Keep hand-written journeys and add a lint for identifier parity.** Cheap, and it is the first step here, but it
  proves only that names match, not that behaviour does.

## Consequences

- A new screen or element is one Rust change; the compiler, the id guard and the conformance checker name every
  platform that has not caught up.
- A requirement now points at elements and scenarios, not prose; `spec:check` sees the generated tags.
- Three small interpreters are new test infrastructure. They stay small only while the verb set is closed, which is
  why the set is pinned.
- Native test code loses its numbers (44, 48, 2.0) and its copy strings: both come from the generated contract and
  the dictionaries.
- The conformance manifests are local and gitignored, like screenshot references (ADR-0031); the nightly native
  workflow runs the checker on real builds.
