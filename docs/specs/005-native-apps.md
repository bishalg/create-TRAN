# 005 Native apps (iOS and Android)

Scope: `apps/ios` (SwiftUI) and `apps/android` (Jetpack Compose). Both call the Rust core through `crates/tran-uniffi`.
Rationale: [ADR-0001](../adr/0001-rust-is-the-source-of-truth.md), [ADR-0014](../adr/0014-native-swift-kotlin-uniffi.md).

### REQ-NAT-001 [verified] Same rules as every other platform

Offline eligibility on iOS and Android MUST come from the Rust core via UniFFI and MUST pass the shared golden fixtures.
**Verified by:** native unit tests reading `fixtures/vote-eligibility.json`.

### REQ-NAT-002 [verified] Works offline

The device check MUST work with no network: the verdict is computed and shown before any API call
and MUST NOT wait for it or be replaced by it (see REQ-NAT-011).
**Verified by:** XCUITest journeys and Compose instrumentation through the real Rust core
([`VotingUITests.swift`](../../apps/ios/Tests/TranVotingDemoUITests/VotingUITests.swift),
[`VotingHomeAccessibilityTest.kt`](../../apps/android/app/src/androidTest/kotlin/com/tran/voting/ui/VotingHomeAccessibilityTest.kt)),
including journeys that point the client at an unreachable port and still assert the verdict; the
client unit tests stub every network call.

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

The app owns every interactive control it lays out, and all of them MUST be at least 44×44 pt (iOS) / 48×48 dp
(Android) — including every segment of `TranSegmented`, so the earlier system-picker exception is gone.
**Verified by:** XCUITest frame assertions for app-owned controls including each theme segment,
`performAccessibilityAudit` across all four themes, and the Compose test asserting every control's
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

### REQ-NAT-010 [verified] Native UI atoms

iOS and Android feature code MUST compose from the atom layer (`TranScreen`, `TranText`, `TranStack`, `TranInline`,
`TranBox`, `TranSurface`, `TranButton`, `TranField`, `TranSegmented`, `TranDivider`) with the same names on both
platforms instead of raw SwiftUI / Material3 controls. Gaps MUST come from `TranGap`, whose names match the
generated space scale (`xxs…xxl`, i.e. web `2xl`), colours from the palette, and each atom MUST carry the
accessibility contract (spoken labels, selected traits, polite live regions, 44/48 pt targets) so feature code
never hand-rolls them ([ADR-0022](../adr/0022-native-atoms.md)).
**Verified by:** [`native-atoms.test.ts`](../../packages/core-ts/tests/native-atoms.test.ts) — raw
`Text`/`Button`/`TextField`/`Picker`/`Divider` (iOS) and their Material3 counterparts (Android) outside the atoms
directories fail a regex guard; atom names are identical on both platforms, and `TranGap` is pinned to
`tokens.json` — plus the XCUITest and Compose assertions on the atoms themselves.

### REQ-NAT-011 [verified] API clients

Both apps MUST reach the Axum API through a small client (`GET /api/health`, `POST /api/vote/eligibility`) whose base
URL is configurable per build — iOS `TranApiBaseUrl` (launch argument → Info.plist `$(TRAN_API_BASE_URL)`), Android
`tranApiBaseUrl` Gradle property / `TRAN_API_BASE_URL` (BuildConfig) — defaulting to `http://127.0.0.1:3001` on iOS
and `http://10.0.2.2:3001` on the Android emulator, with an `https://` release default and **debug-only cleartext**
(Android debug `networkSecurityConfig` scoped to the emulator host and loopback; iOS `NSAllowsLocalNetworking`
instead of `NSAllowsArbitraryLoads`). `X-Debug-Country` MUST be sent only by debug builds, and an unreachable API
MUST only flip the status pill to `shell.status.offline` and show the web's `eligibility.offlineNotice` — never the
verdict (REQ-NAT-002).
**Verified by:** iOS unit tests with a stubbed `URLSession` and Android unit tests on `MockWebServer`
([`TranApiClientTests.swift`](../../apps/ios/Tests/TranVotingDemoTests/TranApiClientTests.swift),
[`TranApiClientTests.kt`](../../apps/android/app/src/test/kotlin/com/tran/voting/api/TranApiClientTests.kt)),
offline UI journeys through an unreachable base URL, and
[`native-networking.test.ts`](../../packages/core-ts/tests/native-networking.test.ts) guarding the manifests,
Gradle config and generated Info.plist.

### REQ-NAT-012 [verified] The device check works in every locale

The reference date a native app hands the Rust core MUST be ISO 8601 (`YYYY-MM-DD`, Gregorian, ASCII digits, UTC)
whatever the device's language, numbering system or calendar. Found by the iOS screenshots (REQ-PERF-007): in Nepali,
a locale-following formatter wrote Devanagari digits and every check answered "enter a valid date".
