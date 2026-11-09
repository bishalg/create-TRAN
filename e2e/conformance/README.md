# Conformance manifests

Each platform's screen-scenario suite records here what it showed to assistive technology, and
`pnpm screens:check` (`tooling/screens-check/screens-check.mjs`) compares it with the screen contract in
`crates/rust-core/src/screens` ([spec 021](../../docs/specs/021-screen-contract.md) REQ-SCR-008,
[ADR-0038](../../docs/adr/0038-screen-contract.md) decision 6). The manifests are local and gitignored, like
screenshot references (ADR-0031): run the suites, then the check.

| Platform | Written by                                                       | How it gets here                                                                                                                                                                                                                                                                 |
| :------- | :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web      | `e2e/support/conformance.ts`, from `e2e/steps/screens.steps.ts`  | `pnpm test:e2e`. Each scenario writes a part file (Playwright runs workers in parallel); the global teardown joins them into `web.json`. Roles and names are Chromium's (`Accessibility.getFullAXTree` over CDP).                                                                |
| iOS      | `apps/ios/Tests/TranVotingDemoUITests/ConformanceManifest.swift` | `pnpm ios:test`. The simulator shares the Mac's file system, so the UI-test process writes `ios.json` here directly, found from its own source path (`#filePath`). Nothing to copy.                                                                                              |
| Android  | `apps/android/app/src/androidTest/…/ui/ConformanceManifest.kt`   | `pnpm android:test`. The instrumentation writes `android.json` to its `additionalTestOutputDir`; the Android Gradle plugin pulls that folder into `app/build/outputs/connected_android_test_additional_output/`, and `apps/android/scripts/conformance.sh` copies the file here. |

Each scenario records a snapshot after its given state, after every `When` step and after its last `Then` (a
snapshot equal to the one before is dropped). iOS waits until two reads of the tree agree, so an alert that is still
animating in is seen; Compose waits for idle. A run of a subset of scenarios writes a partial manifest, which then
fails "never observed"; run the whole suite before the check.

## Shape

```json
{
  "platform": "web",
  "snapshots": [
    {
      "platform": "web",
      "scenario": "An adult in Nepal is eligible",
      "phase": "I tap \"check-button\"",
      "locale": "en",
      "elements": [
        {
          "id": "offline-result",
          "role": "status",
          "name": "Result",
          "value": "Age 20 meets the minimum voting age of 18 in NP.",
          "interactive": false,
          "frame": { "x": 469, "y": 690, "width": 402, "height": 24 },
          "unit": "css_px"
        }
      ]
    }
  ]
}
```

- `id`: the contract id when the node carries one (`data-testid`, `accessibilityIdentifier`, `testTag`). iOS also
  reports identifiers the system gives (an SF Symbol is named after itself); the check ignores those unless the node is
  interactive. The iOS alert's buttons cannot carry an identifier (docs/LEARNINGS.md, 2026-10-21): they take the id
  whose label they read, as `ContractScreenDriver` finds them, marked `"matched": "label"`.
- `role`: the platform's own vocabulary: an ARIA role (web), an `XCUIElement.ElementType` case name (iOS), a Compose
  `Role` or, without one, `TextField` / `Text` / `ProgressBar` / `None` from the node's semantics (Android, which also
  lists the node's `actions`).
- `name` and `value`: what a screen reader reads. Web: the accessible name, and the value or the text inside. iOS:
  `label` and `value`. Android: the content description (else the text), and the text when there is a description.
- `interactive`: the node takes a tap or text input (web: an ARIA widget role; iOS: a control type; Android: an
  `OnClick` or `SetText` action). Every interactive node is recorded, identified or not; other nodes only with an id.
- `frame` and `unit`: CSS pixels (border box), points, or density-independent pixels (touch bounds).
- `within`: the nearest ancestor carrying an identifier. A segmented control's option names its control this way, or
  by the id `<control id>-<option>`. `under` (iOS): system containers above the node (keyboard, alert, navigation bar).

## The rules

See the comment at the top of `tooling/screens-check/screens-check.mjs` for the inputs and the role tables. In short,
for each snapshot the check finds the screen (most always-present ids in common, then fewest missing; a snapshot with
none is a modal state of the screen the scenario showed before), then requires every always-present element, the role
the element's kind allows on that platform, the label as its name (contained in name and value for content: texts,
live regions, banners, toasts), the platform minimum for `control` and `primary` elements, and no interactive node the
contract does not declare on that platform, except the few the platform itself places (the iOS keyboard). Across the
manifest every conditional element must appear at least once, unless its state is listed in the contract's
`UNREACHED_STATES` with the reason.

## In CI

`pnpm test:all` and the `e2e` job of `.github/workflows/ci.yml` check the web manifest. The nightly
`.github/workflows/native-tests.yml` runs `pnpm screens:check` after `pnpm ios:test` and after `pnpm android:test`,
each job with its own manifest (the others are reported as missing, which passes).
