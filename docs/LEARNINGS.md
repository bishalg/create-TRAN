# Learnings

Lessons that change how the next person or agent works in this repo. Read it before starting a task; add to it only
when you learned something that is not obvious from the code, the specs or the ADRs (ADR-0032, REQ-AGT-009).

- A **decision** goes in an ADR. A **bug** gets a test. A **rule** goes in `AGENTS.md`. What is left, and would have
  saved you an hour, goes here.
- Routine work is not a learning: "added a test for X" belongs in the commit message.
- Format, checked by `pnpm agents:check`: a `## YYYY-MM-DD - Title` heading, then a `**Learning:**` and an
  `**Action:**` line. Newest first. Delete an entry when the code makes it obsolete.

## 2026-10-22 - Green locally can mean "built by hand earlier"

**Learning:** The Android JVM parity and screenshot tests load the host build of `tran-uniffi` from `target/release`.
Nothing in Gradle built it, so they passed on every machine where someone had once run `cargo build --release`, and
failed with `UnsatisfiedLinkError` on the nightly CI runner for two nights before anyone looked.
**Action:** A test that needs a build output declares the task that makes it (`buildHostRustLib` in
`apps/android/app/build.gradle.kts`). To check, move the output aside and run the test; and read failing scheduled
runs (`gh run list --workflow native-tests.yml`), not only the push checks.

## 2026-10-22 - A script's "am I main?" check must resolve symlinks

**Learning:** `import.meta.url === pathToFileURL(process.argv[1]).href` is false when the script is started through a
symlinked path, because Node resolves the module URL but not `argv[1]`. On macOS every temp folder is one
(`/var/folders` → `/private/var/folders`), so tooling run inside a scaffolded test project silently skipped `main()`
and exited 0: two scaffold smoke assertions had passed since they were written without ever running.
**Action:** Compare against `pathToFileURL(realpathSync(process.argv[1])).href`. `pnpm tooling:test` runs every tool
through a symlink and rejects the unresolved pattern. When a test only checks an exit code, also check one line of
output that only the real work prints.

## 2026-10-22 - pnpm 11 ignores overrides in package.json

**Learning:** pnpm 11 reads `overrides` only from `pnpm-workspace.yaml`. A `pnpm.overrides` block in the root
`package.json` is silently ignored: `pnpm install` reports "Already up to date" and `pnpm audit` still lists the
advisory, so it looks as if the override range is wrong.
**Action:** Put overrides under `overrides:` in `pnpm-workspace.yaml`, keyed by the vulnerable range
(`'name@<fixed': '>=fixed'`), and confirm with `pnpm audit` after `pnpm install`.

## 2026-10-21 - Static Stryker mutants show as survivors without being run

**Learning:** Stryker reports mutants in module-level code (for example the `Map` built at the top of
`packages/core-ts/src/feedback.ts`) as `Survived` with `static: true` and no covering tests: the in-place vitest
runner does not reload modules, so no test ever ran against them. They are not missing assertions. The agent
`mutation-survivors` found this on its first real run.
**Action:** Read `static` and `coveredBy` in `reports/mutation/mutation.json` before writing a test for a survivor.
Static ones need `ignoreStatic: true` or a module reload, not a test.

## 2026-10-21 - Screenshots in every locale catch what English tests cannot

**Learning:** iOS formatted the reference date with `DateFormatter`, which follows the device locale and wrote
Devanagari digits in Nepali. The Rust core rejected them, so every offline check failed in Nepali. All UI tests ran
in English and passed; only the screenshot matrix (every theme × locale) showed it.
**Action:** Strings that cross into Rust or the API are machine formats: use `ISO8601DateFormatter` or
`atOffset(UTC)`, never a locale-aware formatter (REQ-NAT-012). Run `pnpm ios:screenshots` after touching formatting.

## 2026-10-21 - An accessibility identifier on a SwiftUI alert button duplicates it

**Learning:** On iOS 27, `.accessibilityIdentifier` on a button inside a SwiftUI `.alert` makes XCUITest see the
button twice, and every query for it fails with "Multiple matching elements found".
**Action:** Find alert buttons by position inside `app.alerts.firstMatch`, and assert the button count first.

## 2026-10-21 - Robolectric can lose a coroutine resume after a Dispatchers.IO hop

**Learning:** About one screenshot test in fifty stayed on "Checking API…" although the fake API had answered: the
resume from `Dispatchers.IO` back to Robolectric's main looper was lost. Idling the looper did not fix it.
**Action:** Classes that switch dispatchers take the dispatcher as a constructor parameter (`TranApiClient(io = …)`);
JVM UI tests pass `Dispatchers.Unconfined`.
