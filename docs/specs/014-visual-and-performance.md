# 014 Visual and performance baselines

Scope: screenshot comparison (web, Android, iOS), release smoke tests, measured performance and size budgets, and keeping generated output out
of git. Rationale: [ADR-0031](../adr/0031-visual-and-performance-baselines.md).

### REQ-PERF-001 [verified] Generated output is never tracked

No file under a generated-output folder (screenshots, coverage, test results, Playwright and mutation reports,
`.metrics/`) may be tracked by git, and each such folder MUST be ignored. Committed reports live only in
`docs/reports/` and are text.

### REQ-PERF-002 [verified] Every theme and locale is screenshot-compared on the web

The production web build MUST be captured for every registry theme × every locale, plus the result and the sign-out
dialog, and compared with the machine's recorded references. A missing reference is recorded on first run; a
difference fails with diff images. References are gitignored.

### REQ-PERF-003 [verified] Android screens are screenshot-compared without an emulator

The real Compose screens MUST be rendered in JVM tests for every registry theme, with the Rust core loaded, and
compared with the machine's recorded references (gitignored, recorded on first run).

### REQ-PERF-004 [verified] Web performance is measured as medians of the production build

`pnpm metrics` MUST report Lighthouse performance, accessibility, best-practices and SEO scores and first contentful
paint, largest contentful paint, cumulative layout shift, total blocking time and load time, each the median of
several runs of the production build.

### REQ-PERF-005 [verified] Sizes are measured for every deliverable

`pnpm metrics` MUST report the gzipped JavaScript and CSS of the web build and, when built, the Android APK, the iOS
app, the API release binary and the native Rust library; an artefact that is not built is reported as missing, not as
zero.

### REQ-PERF-006 [verified] Budgets and regressions fail the run; history is committed text

A metric beyond its budget in `tooling/metrics/budgets.json` MUST fail the run and name the metric, as MUST a
regression against the last comparable record:

- a Lighthouse score more than 5 points lower (any machine: its throttling is simulated);
- a web or app bundle size more than 5% larger (any machine), or a native binary more than 5% larger (same platform:
  binaries differ per OS);
- a timing more than 25% **and** more than 50 ms slower (same machine only; the floor keeps millisecond noise from
  failing the run).

`--record` MUST append the run to `docs/reports/metrics.json` and regenerate `docs/reports/metrics.md`, and MUST refuse
a failing run unless `--accept` is given, so a regression never silently becomes the new baseline. With no history,
the first run is recorded as the baseline.

### REQ-PERF-007 [verified] iOS screens are screenshot-compared on a simulator

The real app MUST be driven on an iOS simulator for every registry theme × every locale through home, result,
sign-out dialog, welcome and auditor, and each screen compared with the machine's references — recorded on first run,
gitignored, kept per simulator model and iOS version. The status bar MUST be fixed so the clock never differs.

### REQ-PERF-008 [verified] Release builds start and work

The production web build MUST load without console errors and answer an eligibility check. The release Android APK
MUST contain the Rust core for every shipped ABI and, when a device is attached, launch and stay running. The Release
iOS app MUST launch on a simulator and stay running. A check whose tool or device is absent MUST say it was skipped,
never pass silently.
