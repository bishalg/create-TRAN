# 005 Native apps (iOS and Android)

Scope: `apps/ios` (SwiftUI) and `apps/android` (Jetpack Compose). Both call the Rust core through `crates/tran-uniffi`.
Rationale: [ADR-0001](../adr/0001-rust-is-the-source-of-truth.md), [ADR-0014](../adr/0014-native-swift-kotlin-uniffi.md).

### REQ-NAT-001 [verified] Same rules as every other platform

Offline eligibility on iOS and Android MUST come from the Rust core via UniFFI and MUST pass the shared golden fixtures.
**Verified by:** native unit tests reading `fixtures/vote-eligibility.json`.

### REQ-NAT-002 [verified] Works offline

The device check MUST work with no network.
**Verified by:** XCUITest journeys and Compose instrumentation through the real Rust core
([`VotingUITests.swift`](../../apps/ios/Tests/TranVotingDemoUITests/VotingUITests.swift),
[`VotingHomeAccessibilityTest.kt`](../../apps/android/app/src/androidTest/kotlin/com/tran/voting/ui/VotingHomeAccessibilityTest.kt));
neither app contains networking code.

### REQ-NAT-003 [verified] Screen reader labels

Every control MUST have a spoken label and role; the verdict MUST be announced when it changes (VoiceOver: announcement /
`.updatesFrequently`; TalkBack: `liveRegion = Polite`).
**Verified by:** XCUITest `performAccessibilityAudit` on every theme; Compose tests for labels, roles and
`LiveRegionMode.Polite` (`VotingHomeAccessibilityTest.kt`).

### REQ-NAT-004 [verified] Text scaling

At the largest Dynamic Type size (iOS) and 200% font scale (Android) all content MUST remain reachable without truncation of the verdict.
**Verified by:** XCUITest relaunch at `UICTContentSizeCategoryAccessibilityXXXL` asserting the verdict grows and stays
reachable; Compose test at `fontScale = 2f` scrolling to the intact verdict.

### REQ-NAT-005 [verified] Touch targets

Interactive controls MUST be at least 44×44 pt (iOS) / 48×48 dp (Android).
**Verified by:** XCUITest frame assertions plus the audit's hit-region check; Compose test asserting every control's
`touchBoundsInRoot` is at least 48×48 dp.

### REQ-NAT-006 [verified] Reduced motion and contrast

Animations MUST respect Reduce Motion / animation-scale settings; text contrast MUST meet 4.5:1 in every registered theme.
**Verified by:** Rust-derived action colours (`palette.action`/`onAction`, mixed 82/18 toward the theme's own text colour)
keep every palette AA — asserted in `tokens.rs` (`every_theme_keeps_action_fill_above_aa_contrast`); XCUITest
`performAccessibilityAudit` walks light, dark, black and sepia; Compose contrast assertions per theme; iOS session
transitions go through `TranMotion.animation(reduceMotion:)` ([`TranMotionTests.swift`](../../apps/ios/Tests/TranVotingDemoTests/TranMotionTests.swift)).

### REQ-NAT-007 [verified] Theme registry

Every palette in the rust-core theme registry MUST be selectable on the voter dashboard and MUST apply its own colour
tokens; screens MUST receive a palette and MUST NOT branch on a light/dark boolean.
**Verified by:** XCUITest iterating every picker entry, Compose test iterating `TranTheme.entries`, Maestro
[`theme` flow](../../e2e/maestro/flows/theme.yaml), generated palette parity with `tokens.json`.

### REQ-NAT-008 [verified] Native copy comes from the shared dictionaries

iOS and Android string resources MUST be generated from the shared root `locales/`
dictionaries (see [008](008-localization.md) and
[ADR-0020](../adr/0020-localization-modules-and-english-fallback.md)): per-module String
Catalogs under `apps/ios/.../Generated/Strings/` with typed `L10n` accessors, and
`res/values{,-ne,-hi}/strings_<module>.xml` with typed `TranStrings` accessors — matching the
dictionaries key-for-key and value-for-value, with English as the base language and the
fallback. The core's English `reason`/`detail` is never shown: the verdict sentence is built from facts
(see REQ-I18N-007).
**Verified by:** [`packages/core-ts/tests/native-strings.test.ts`](../../packages/core-ts/tests/native-strings.test.ts).

### REQ-NAT-009 [verified] Native layout uses generated tokens only

Spacing, radii and sizes in iOS and Android feature code MUST come from the generated `TranSpace` / `TranRadius`
scales (emitted from `crates/rust-core/src/tokens.rs` by `pnpm tokens:sync`), and colours from the palette. Numeric
`spacing:`/`.padding(n)`/`n.dp`/`n.sp`, `Color(0x…)` and fixed `.system(size:)` fonts MUST NOT appear in feature code.
**Verified by:** [`native-tokens.test.ts`](../../packages/core-ts/tests/native-tokens.test.ts).
