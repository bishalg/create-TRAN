# 018 Loading, offline and interrupted states

Scope: what the user sees while an answer is on its way, when it never comes, and when they move on before it
arrives — on the web (`apps/web`), iOS (`apps/ios`) and Android (`apps/android`), with the policy in
`crates/rust-core`. Builds on [011](011-error-feedback.md) (how a failure is shown), [012](012-failure-modes.md)
(cancellation, only the newest answer counts — REQ-ROB-006) and [005](005-native-apps.md) (the native verdict is
computed on the device first — REQ-NAT-002). Rationale: [ADR-0035](../adr/0035-loading-and-offline-states.md).
Golden cases: `fixtures/feedback.json` (`loadingPolicy`, `verdictSources`).

Vocabulary used below:

- A **check** is the web's server-mode eligibility request, or — on iOS and Android — the background server
  confirmation that follows a device verdict (ADR-0023).
- A check is **pending** once it has been in flight for longer than the indicator delay.
- The **source** of a verdict is who vouched for it: `device` (the device rules, no server involved), `server` (the
  server answered) or `device_fallback` (the server was asked and could not answer, so the device rules decided).

### REQ-LOAD-001 [planned] The waiting policy is one Rust table

`crates/rust-core/src/feedback.rs` MUST define `LOADING_POLICY` — `indicator_delay_ms` and `pending_message_key`, the
locale key of the pending copy — and `VerdictSource` (`device`, `server`, `device_fallback`), each variant with the
locale key of its label. The indicator delay MUST be shorter than `SERVER_DEADLINE_MS` (a compile-time assertion).
`pnpm tokens:sync` MUST emit both to `packages/core-ts/src/generated/feedback.ts` (`LOADING_POLICY`,
`VERDICT_SOURCES`, `VerdictSource`); `crates/tran-uniffi` MUST export `loading_policy()` and
`verdict_source_spec()`; every copy MUST pass `fixtures/feedback.json`. No platform may hard-code the delay or a
source label, and every key the table names MUST exist in every locale (REQ-I18N-003).
**Verified by:** `crates/rust-core/tests/feedback_fixtures.rs`, `crates/tran-uniffi/tests/feedback_fixtures.rs`,
`packages/core-ts/tests/feedback.test.ts`, `FeedbackParityTests.swift`, `FeedbackParityTest.kt`,
`packages/core-ts/tests/i18n-guards.test.ts`.

### REQ-LOAD-002 [planned] A progress indicator appears only after the delay

A check that settles within `indicator_delay_ms` MUST NOT show any progress indicator. Once a check has run longer,
the result region MUST show the `pending_message_key` copy inside the live region that already announces results
(web `role="status"` with `aria-busy="true"`; iOS `TranText(live: true)`; Android `liveRegion = Polite`), so a
screen reader hears it once; the indicator MUST disappear the moment the check settles — by an answer, a failure or
a cancellation. The web submit button is disabled as soon as the check starts (REQ-WEB-006), but its label MUST
switch to the progress label only together with the indicator, never earlier. The startup status pill
(`shell.status.checking`) is not a progress indicator and keeps showing at once.
**Verified by:** `apps/web/src/shared/lib/useDelayed.test.ts`, `apps/web/src/app/App.test.tsx`, BDD "A slow server
shows progress after a moment" and "A fast server answer shows no progress indicator", `ServerConfirmationTests.swift`,
`ServerConfirmationTest.kt`.

### REQ-LOAD-003 [planned] The last verdict stays visible while a new check runs

Starting a check MUST NOT blank or replace the verdict on screen: on the web the previous server-mode result stays
(device mode is synchronous); on iOS and Android the device verdict stays. While the check is pending the result MUST
be marked as updating — web `aria-busy="true"` and `data-updating` on the result, toned down through a token, with the
pending copy in place of the source label; native the pending copy as the live caption under the verdict — and MUST
read exactly as before otherwise. When the check settles the new verdict and source replace the old ones in one
update.
**Verified by:** `ResultCard.test.tsx`, `App.test.tsx`, BDD "The last result stays visible while a new check runs",
`VotingUITests.swift`, `VotingHomeAccessibilityTest.kt`.

### REQ-LOAD-004 [planned] Submitting again or leaving cancels the check, and a cancelled check is silent

Starting a new check MUST cancel the one in flight (REQ-ROB-006), and leaving the eligibility screen MUST cancel it
too — on the web signing out unmounts the page while the API hook lives on in the shell; on iOS and Android the view
disappears. A cancelled check MUST NOT change the verdict, the source, the status pill, or show a toast or banner;
`request.cancelled` is logged at `debug` only (its catalogue entry is `silent`).
**Verified by:** `useTranApi.test.tsx` (`cancelCheck`), `App.test.tsx` ("signing out during a server check shows no
late toast"), BDD "Leaving the screen discards a late answer", `ServerConfirmationTests.swift`,
`ServerConfirmationTest.kt`.

### REQ-LOAD-005 [planned] When the server cannot answer, the device decides and the result says so

"Cannot answer" is decided by the transport and the retry budget only: a transport failure (`network.offline`,
`network.timeout`, REQ-ROB-002) or a retryable server failure once the attempts of REQ-ERR-005 are spent. No platform
may consult `navigator.onLine`, `NWPathMonitor`, `ConnectivityManager` or a polling health check to decide. The
verdict MUST then come from the device rules — the TypeScript mirror on the web, the device verdict already on screen
on iOS and Android — and the result MUST carry the `device_fallback` label, distinct from `device` and `server`, so
the user knows which path answered; the banner or toast of REQ-ERR-006 still applies. A later successful check MUST
return the source to `server`. Device-mode checks and the startup health check are unchanged.
**Verified by:** `toView.test.ts`, `useTranApi.test.tsx`, BDD "The server cannot be reached: the device decides and
says so" (and the two existing fallback scenarios in `error-feedback.feature`, updated), `VotingUITests.swift`,
`VotingHomeAccessibilityTest.kt`.

### REQ-LOAD-006 [planned] Motion comes from tokens and bows to reduced motion

`crates/rust-core/src/tokens.rs` MUST define motion durations (`fast`, `base`); `pnpm tokens:sync` MUST emit them as
`--tran-motion-fast` / `--tran-motion-base` (CSS), in `tokens.json` and `designMotion` (TypeScript), `TranMotionDuration`
(Swift, seconds; Kotlin, milliseconds) and a section of the root `DESIGN.md`. `app.css` MUST NOT contain a literal
`s`/`ms` duration outside a custom-property definition; iOS and Android atom and feature code MUST NOT contain a
literal animation duration. When the user prefers reduced motion (web media query, iOS `accessibilityReduceMotion`,
Android animator duration scale `0`) the indicator and the result MUST appear without animation.
**Verified by:** `apps/web/tests/tokens-guard.test.ts` (duration rule), `packages/core-ts/tests/native-tokens.test.ts`
(duration literals), `crates/tran-tokens-codegen/tests/generated_files.rs` (drift), `TranMotionTests.swift`,
`TranMotionTest.kt`, BDD "Motion is removed when the user asks for less" (REQ-A11Y-009).

### REQ-LOAD-007 [planned] Pending and fallback states are screenshot-compared on every platform

The screenshot suites MUST capture, besides the existing screens, a **pending** state (a check held open past the
indicator delay) and a **fallback** state (the server refused, the device answered): web `pending-<theme>.png` and
`offline-<theme>.png` per theme; Android `pending-<theme>-<locale>.png` and `offline-<theme>-<locale>.png` per theme
× locale on the JVM; iOS `pending-<theme>-<locale>.png` per theme × locale on a simulator (its existing
`result-…` shot is the fallback state). Each MUST show the pending copy or the `device_fallback` label; references stay
gitignored (REQ-PERF-001).
**Verified by:** `e2e/visual/web.spec.ts`, `apps/android/app/src/test/…/screenshots/ScreenshotTest.kt`,
`apps/ios/Tests/TranVotingDemoScreenshotTests/ScreenshotTests.swift`.

## Out of scope (deliberately)

- A minimum visible time for the indicator, skeleton screens and spinners: see ADR-0035.
- A total time budget per check beyond the retry policy: three attempts × the 5 s per-attempt timeout is the ceiling
  (REQ-ERR-005, REQ-ROB-004).
- Queueing or replaying a check once the server returns.
