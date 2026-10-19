# ADR-0022 Native atom layer and its guards

Status: accepted

## Context

The web app enforces a thin atom layer (`apps/web/src/shared/ui`) with an import boundary and a token guard, so
feature code never hand-rolls buttons, fields, typography or semantic tags ([ADR-0017](./0017-web-atomic-enforcement.md)).
The native apps had no equivalent: every screen composed raw SwiftUI / Material3 controls, styled ad hoc from the
palette, and re-derived touch sizes, live-region handling and typography by hand. The XCUITest suite also carried an
exception for the iOS system segmented picker, whose ~32 pt height Apple owns (REQ-NAT-005), so the 44 pt rule could
not be asserted for the theme selector.

## Decision

1. **Mirror the web atom names in a native layer.** iOS `Sources/TranVotingDemo/Atoms/` and Android `ui/atoms/`
   provide `TranScreen`, `TranText`, `TranStack`, `TranInline`, `TranBox`, `TranSurface`, `TranButton`,
   `TranField`, `TranSegmented`, `TranDivider` — the same names on both platforms (pinned by
   `native-atoms.test.ts`), because vocabulary drift between platforms is what made the screens diverge before.
2. **Named gap vocabulary from the generated scale.** `TranGap` exposes the spacing steps `xxs…xxl` (web spelling
   `2xl` for the last one). A parity test pins the case list and the `TranSpace` mapping to
   `packages/core-ts/src/generated/tokens.json`, so a `tokens:sync` that renames or drops a step fails the suite.
   Values still come from the generated `TranSpace` — atoms contain no literals either.
3. **Palette through the environment.** SwiftUI `EnvironmentValues.tranPalette` and Compose `LocalTranPalette`
   carry the registry palette (the native analogue of web CSS variables); the root injects it once. Screens keep
   receiving the registry palette (REQ-NAT-007) and still never branch on a light/dark boolean.
4. **The accessibility contract lives in the atoms.** Spoken labels, selected traits, `live` verdict regions and
   the 44/48 pt targets are implemented once, inside the control, so feature code cannot hand-roll them. The iOS
   theme selector is now an app-owned `TranSegmented` — every segment is a ≥44 pt button carrying the selected
   trait — so the REQ-NAT-005 system-picker exception is dropped and the XCUITest asserts 44 pt again.
5. **Guard is a regex, not a type checker.** `native-atoms.test.ts` scans feature sources for raw
   `Text(`/`Button(`/`TextField(`/`Picker(`/`Divider(` (iOS) and their Material3 counterparts (Android) outside the
   atom directories. Formatting variations could evade it and it cannot see through indirection; the value is the
   same as web's: friction plus reviewability.
6. **Platform-native choices where the platforms differ.** Android's `TranSegmented` wraps Material3 chips (they
   already carry selected semantics and the platform's 48 dp touch floor); iOS builds the control by hand because
   the system picker's height is not ours to fix. `TranField` keeps each platform's input style. There is no
   native `TranTable`: table-like rows compose from `TranStack` / `TranInline` / `TranDivider`.

## Consequences

- Feature code can no longer introduce raw text/button/field/picker/divider primitives or ad-hoc gaps; new UI
  concerns go into atoms first, matching web's "atom + test first" checklist.
- The guard is source-level: helper indirection or a coordinated rename could bypass the symbol checks — the
  name-parity test limits the latter.
- Native typography maps to platform semantic styles (Dynamic Type / font scaling) instead of a generated native
  type ramp; a future tokens increment could emit one and tighten `TranText` to it.
- Atom previews (Xcode Canvas / Compose previews) remain a follow-up: `ui-tooling-preview` is not a dependency
  yet and previews would not be exercised by the suites.
