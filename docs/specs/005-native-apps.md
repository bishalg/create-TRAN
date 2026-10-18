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

Animations MUST respect Reduce Motion / animation-scale settings; text contrast MUST meet 4.5:1 in light and dark.
**Verified by:** platform accessibility audits.
