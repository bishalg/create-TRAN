# ADR-0031 Screenshots stay local; metrics are committed text

Status: accepted

## Context

Two kinds of drift slip past behaviour tests. A change can look wrong — a theme's contrast, a locale's long label
wrapping, a layout broken at a phone width — while every assertion still passes. And a change can make the product
heavier or slower: a dependency that doubles the JavaScript, a native library that grows the APK, a render that
delays the first paint. Neither shows up until someone notices, by which time many commits have piled on top.

Screenshots and numbers have opposite storage needs. Images are large binaries that git cannot diff, differ by
machine (fonts, GPU, OS version) and would grow every clone forever. Numbers are a few bytes of text, diff cleanly,
and their history is the trend we want to see.

## Decision

1. **Screenshots are local and gitignored.** The first run on a machine records its references; later runs compare
   against them. Web: Playwright `toHaveScreenshot` against the production build (`e2e/visual`). Android: Roborazzi on
   Robolectric — JVM tests that render the real Compose screens, Rust core included, without an emulator. iOS: an
   XCUITest target that walks the real app on a simulator and compares `XCUIScreen` captures with ~60 lines of Core
   Graphics (no package: snapshot libraries render views in isolation, and SwiftUI views cannot be tapped there; their
   record mode also fails the run that records). References are kept per simulator model and iOS version, and the
   status bar is pinned to 9:41. Playwright and Roborazzi are test-only dependencies; the apps keep using platform
   libraries only. The matrix (themes × locales) is read from
   the generated registry, so a new theme or language is captured without editing a test.
2. **Metrics are committed text.** `pnpm metrics` measures web performance (Lighthouse scores, first contentful
   paint, largest contentful paint, total blocking time, layout shift, speed index; plus Navigation Timing's time to
   first byte, DOM content loaded and load — medians over several runs of the production build) and sizes (web
   JavaScript and CSS gzipped, the release APK and iOS app with `--native`, the API binary, the native Rust library;
   an artefact that is not built is "missing", never 0). It compares them with the last recorded run and with fixed
   budgets, and prints a table. Lighthouse is a test-only dependency of `e2e`, driven through its Node API with the
   desktop preset.
   `pnpm metrics --record` appends the run to `docs/reports/metrics.json` and regenerates `docs/reports/metrics.md`.
   A repository with no history records its first run as the baseline. A failing run is not recorded unless
   `--accept` is given, so a regression never quietly becomes the number the next run is compared with.
3. **Budgets are the hard line.** `tooling/metrics/budgets.json` holds absolute limits (a Lighthouse performance
   score floor, a JavaScript size ceiling, …); exceeding one fails the run. Against the previous comparable record,
   a Lighthouse score may drop at most 5 points, a size grow at most 5%, and a timing at most 25% or 50 ms, whichever
   is larger (timings are noisy, and 25% of a 3 ms time to first byte is noise); raising a budget is a reviewed commit.
4. **Each metric is compared only where it means the same thing.** Each record carries a machine label (OS, CPU,
   cores) and platform (OS, architecture). Timings are judged only against the same machine; native binaries (API,
   Rust library) only against the same platform, since they differ per OS; Lighthouse scores, web bundles and app
   bundles everywhere — Lighthouse throttling is simulated, and bundles do not depend on the build machine. Layout
   shift is held to its budget only.
5. **Generated output is never tracked.** A guard test fails when a file under a known output folder (reports,
   coverage, screenshots, test results, mutation output) is tracked by git or not ignored.

## Consequences

- A fresh clone has no screenshot references; its first visual run passes and records them. CI
  (`.github/workflows/baselines.yml`, nightly) keeps its own web and Android references in the Actions cache, keyed
  by OS. iOS screenshots stay local: simulator images change with every Xcode and runtime update.
- Visual changes are reviewed by looking at the diff images Playwright and Roborazzi write on failure, then
  re-recording (`pnpm visual:update`, `pnpm android:screenshots:record`, `pnpm ios:screenshots:record`).
- `pnpm smoke` checks the release builds users get: the production web build loads without console errors and
  answers a server check, the release APK carries the Rust core for every ABI and stays running on a device, and the
  Release iOS app stays running on a simulator. A missing tool or device is a reported skip, not a pass.
- The metrics report is a deliberate artefact: recorded before a release or a PR that may move a number, not on every
  run, so routine work never produces noisy diffs.
- Timings recorded on one laptop are not a contract for another; the scores and sizes are the numbers that travel.
- Roborazzi is pinned to 1.60.0, the last release whose Kotlin metadata the app's Kotlin 2.0 compiler can read;
  upgrading Kotlin unlocks newer releases.
