# Learnings

Lessons that change how the next person or agent works in this repo. Read it before starting a task; add to it only
when you learned something that is not obvious from the code, the specs or the ADRs (ADR-0032, REQ-AGT-009).

- A **decision** goes in an ADR. A **bug** gets a test. A **rule** goes in `AGENTS.md`. What is left, and would have
  saved you an hour, goes here.
- Routine work is not a learning: "added a test for X" belongs in the commit message.
- Format, checked by `pnpm agents:check`: a `## YYYY-MM-DD - Title` heading, then a `**Learning:**` and an
  `**Action:**` line. Newest first. Delete an entry when the code makes it obsolete.

## 2026-11-10 - A caught `new Function` still breaks a strict CSP

**Learning:** Zod 4 compiles object parsers with `new Function` and probes whether it may, inside a `try`. Under the
built web app's CSP (no `'unsafe-eval'`, REQ-SEC-024) the throw is swallowed, but Chrome still fires a
`securitypolicyviolation`, so `pnpm smoke` failed with `script-src eval` although the app worked. The dev server
carries no CSP, so no other suite sees it.
**Action:** Import `z` from `packages/api/src/schemas/zod.ts`, which sets `jitless` before any schema exists. Before
adding a browser dependency, run `pnpm smoke`; fix a violation at its source, never by widening the policy.

## 2026-11-10 - A labelled text reads its content as its value, not its label

**Learning:** `pnpm screens:check` requires content that changes (the verdict, the API status, the role badge) to be
named by its contract label, so `TranText(label:)` now gives VoiceOver "Result" as `label` and the verdict as `value`,
and Android's content description becomes "Result, <verdict>". An XCUITest that reads `element.label` of such a text
gets "Result"; on the web, the role badge and the verdict source start with a screen-reader-only label, so an exact
`toHaveText` includes it.
**Action:** Read a labelled text's content from `value` on iOS (`ContractScreenDriver.text(of:)`), from `Text` (not
the content description) on Android, and by an inner element or a substring on the web.

## 2026-11-09 - A `const fn` that only builds `const` tables counts as uncovered

**Learning:** `cargo llvm-cov` measures run time only. A `const fn` helper used solely inside `const` items (the
screen catalogue's `element`, `Scenario::new`) is evaluated by the compiler, so its regions report 0% and
`pnpm test:rust:coverage` fails at 100% although every table is tested. Inside those tables, `&helper(..)` as an
argument is also not promoted to `'static` (only literals and paths are), so nested slices built by a `const fn` do not
compile at all.
**Action:** Call each table-building `const fn` once from a test at run time; build nested slices from literals or
`macro_rules!`, not from `const fn` calls (see `crates/rust-core/src/screens/scenarios.rs`).

## 2026-10-22 - Layout bugs hide on big phones and in Robolectric's default mode

**Learning:** The default CI emulator (`reactivecircus/android-emulator-runner` with no profile) is 320 × 640 dp,
narrower than any development phone. There the dashboard's subtitle took the whole header row and squeezed Android's
sign-out button to 0 dp; the instrumentation test reported it as "The component is not displayed", which looks like a
timing flake and is not. A Robolectric test of the same screen passed until it used `@GraphicsMode(NATIVE)`: the
legacy mode measures text too small to overflow.
**Action:** Reproduce CI emulator failures on the same profile (`avdmanager create avd` with no `--device`). Layout
assertions in Robolectric use `@GraphicsMode(NATIVE)` and a `qualifiers` screen size (see `NarrowScreenTest`). Prove a
layout test by breaking the layout and watching it fail.

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

## 2026-11-10 - The screen id guard reads comments too

**Learning:** `packages/core-ts/tests/screen-ids.test.ts` flags any quoted or backticked string spelled like a
declared element id, comments included, and a `data-testid={cond ? …}` expression looks like a literal to it. Both
failed the guard while adding the web interpreter.
**Action:** In app and test code, name elements in comments in plain words ("the check button") and compute a
conditional test id into a variable first (`data-testid={checkButtonId}`). The generated Gherkin is the only place ids
are spelled out, and the interpreter reads them from there at run time.
