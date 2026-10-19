# 005 Native apps (iOS and Android)

Scope: `apps/ios` (SwiftUI) and `apps/android` (Jetpack Compose). Both call the Rust core through `crates/tran-uniffi`.
Rationale: [ADR-0001](../adr/0001-rust-is-the-source-of-truth.md), [ADR-0014](../adr/0014-native-swift-kotlin-uniffi.md).

### REQ-NAT-001 [verified] Same rules as every other platform

Offline eligibility on iOS and Android MUST come from the Rust core via UniFFI and MUST pass the shared golden fixtures.
**Verified by:** native unit tests reading `fixtures/vote-eligibility.json`.

### REQ-NAT-002 [planned] Works offline

The device check MUST work with no network.
**Verified by:** native UI tests.

### REQ-NAT-003 [planned] Screen reader labels

Every control MUST have a spoken label and role; the verdict MUST be announced when it changes (VoiceOver: announcement /
`.updatesFrequently`; TalkBack: `liveRegion = Polite`).
**Verified by:** XCUITest `performAccessibilityAudit`; Compose semantics tests.

### REQ-NAT-004 [planned] Text scaling

At the largest Dynamic Type size (iOS) and 200% font scale (Android) all content MUST remain reachable without truncation of the verdict.
**Verified by:** UI tests at max text size.

### REQ-NAT-005 [planned] Touch targets

Interactive controls MUST be at least 44×44 pt (iOS) / 48×48 dp (Android).
**Verified by:** Android `checkAccessibility`/semantics size assertions; iOS audit.

### REQ-NAT-006 [planned] Reduced motion and contrast

Animations MUST respect Reduce Motion / animation-scale settings; text contrast MUST meet 4.5:1 in every registered theme.
**Verified by:** platform accessibility audits.

### REQ-NAT-007 [planned] Theme registry

Every palette in the rust-core theme registry MUST be selectable on the voter dashboard and MUST apply its own colour
tokens; screens MUST receive a palette and MUST NOT branch on a light/dark boolean.
**Verified by:** XCUITest theme picker checks, Maestro `theme` flow, generated palette parity with `tokens.json`.

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
