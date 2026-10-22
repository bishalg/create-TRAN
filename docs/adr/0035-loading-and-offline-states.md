# ADR-0035: Waiting is a state with a policy — delayed indicators, kept verdicts, honest fallback

**Status:** Accepted · **Date:** 2026-10-22 · **Spec:** [018](../specs/018-loading-and-offline.md)

## Context

The error side is deep: one catalogue in Rust decides how every failure is logged, retried and shown (ADR-0028), the
failure modes are a fixture (ADR-0029). The _waiting_ side is improvised per platform:

- **Web.** `apps/web/src/shared/api/useTranApi.ts` already cancels the previous call per slot with an
  `AbortController` (`latest`, REQ-ROB-006), retries and falls back to the device rules (`fallBack`, REQ-ERR-005),
  and keeps `lastApiResult` while a new check runs. But `isChecking` flips on the first render of a check, so the
  button reads "Checking…" for a 10 ms loopback answer and the label flickers; the kept result is not marked as
  updating; and after a fallback the card says "Checked on this device" as if the user had asked the device
  (`features/eligibility/toView.ts` maps the fallback to `source: 'device'`, a TypeScript-only union). The hook lives
  in `App.tsx`'s `Shell`, not in `EligibilityPage`, so signing out during a check does not abort it: the answer lands
  on the welcome screen as a "Server check complete" toast.
- **iOS and Android.** The verdict is computed on the device and the server only confirms in the background
  (ADR-0023). `VotingHomeView.swift` starts an unstructured `Task { }` per tap that nothing cancels — a second tap
  while the first confirmation is slow lets two answers race for the status pill and the toast; the health check in
  `.task` is cancelled on disappear, the confirmation is not. `VotingHomeScreen.kt` launches into
  `rememberCoroutineScope()`, which cancels on leaving the composition but not on the next tap. Neither screen has a
  pending state for the confirmation (only the startup pill says "Checking API…"), and neither tells the user whether
  the server agreed or was unreachable except through the pill and the banner.
- **Policy.** `crates/rust-core/src/feedback.rs` already holds the timings that are policy (`RETRY_POLICY`,
  `SERVER_DEADLINE_MS`, `ToastDuration::millis`) and `crates/tran-uniffi/src/feedback.rs` exports them
  (`retry_policy()`, `toast_duration_ms()`). There is no indicator delay anywhere, and no shared notion of "which path
  answered".
- **Motion.** `tokens.rs` has no motion tokens; `apps/web/src/styles/app.css` carries literal `0.15s`, `0.2s` and
  `0.25s` durations that `tokens-guard.test.ts` cannot see (it checks `px`/`rem` only); iOS `TranMotion.swift` is
  hand-written around `.default`; Android has no animation at all. Reduced motion is handled on the web (a media
  query) and iOS (`accessibilityReduceMotion` in `NavigationCoordinatorView`), not on Android.

## Decision

1. **The waiting policy is a Rust table, like the error policy.** `feedback.rs` gains `LOADING_POLICY`
   (`indicator_delay_ms: 300`, `pending_message_key`) and `VerdictSource { Device, Server, DeviceFallback }` with a
   locale key per variant; a compile-time assertion keeps the delay below `SERVER_DEADLINE_MS`. `pnpm tokens:sync`
   emits them to `generated/feedback.ts`; `tran-uniffi` exports `loading_policy()` and `verdict_source_spec()`;
   `fixtures/feedback.json` pins all four copies (ADR-0002, ADR-0027). The message keys live in the table so the
   dead-key guard (`i18n-guards.test.ts`) can count them as used, exactly as it does for the catalogue.
   300 ms is chosen so that a loopback answer (tens of ms) and a single transient retry (`half + jitter` of 100–200 ms
   plus the attempt) finish silently, while a stalled request is acknowledged well before the 5 s per-attempt
   timeout.
2. **Delay only, no minimum visible time.** A delay removes the flicker that matters (an indicator for a fast
   answer). A minimum display time would add a second timer and a "finished but still pretending" state on three
   platforms to hide the rarer flash of an answer arriving just after the delay — and it would delay the result. Not
   worth its weight in a one-card sample; revisit if a real app adds a spinner.
3. **The indicator is text in the live region that already exists, not a spinner or a skeleton.** The pending copy
   ("Checking with the server…") is rendered where the result is announced, so screen readers hear one change; it is
   localized through the dictionaries, stable in screenshots and needs no motion. Skeleton screens were rejected:
   there is nothing to outline on a one-card screen, and the previous verdict is more useful than a grey box. A
   spinner was rejected: it needs its own accessible name, its own motion, and says less than a sentence.
4. **Keep the last verdict and mark it, never blank it.** The state stays per request in the hook / the screen (the
   existing `lastApiResult` on the web, the device verdict on native); a global "loading" flag was rejected because the
   status pill, the health check and the eligibility check have different owners and lifetimes and would hide each
   other. While pending, the web result carries `aria-busy` and `data-updating` (toned down through a token), the
   native result shows the pending copy as its live caption.
5. **Cancellation is owned by the screen, and a cancelled check is silent.** Web: `useTranApi` exposes
   `cancelCheck()` and `EligibilityPage` calls it from its unmount effect, because the hook outlives the page. Native:
   a small `ServerConfirmation` owner (one `Task` / one `Job`, `start` cancels the previous one, `cancel()` on
   disappear) replaces the loose `Task { }` and `scope.launch`. `request.cancelled` is already `silent` in the
   catalogue; nothing on screen changes for a superseded answer (REQ-ROB-006).
6. **Offline is what the transport says, plus the retry budget.** The existing classification (`network.offline`,
   `network.timeout`, REQ-ROB-002) and the fallback after the retries (REQ-ERR-005) are the detection. Platform
   connectivity APIs (`navigator.onLine`, `NWPathMonitor`, `ConnectivityManager`) and polling were rejected: they are
   wrong behind captive portals and VPNs, need extra plumbing and permissions, and would be a second source of truth
   that can disagree with the request that actually failed. The cost is a bounded wait on a black-holed network
   (three attempts × 5 s plus backoff, ≈ 15.5 s worst case; a refused connection fails at once), which the pending
   indicator now explains. The fallback verdict is labelled `device_fallback` ("The server could not answer — checked
   on this device"), distinct from a device-mode check.
7. **Two motion tokens, guarded.** `tokens.rs` gains `MotionTokens { fast: "150ms", base: "250ms" }`, generated to
   CSS, the TypeScript snapshot, Swift (`TranMotionDuration`, seconds) and Kotlin (`TranMotionDuration`,
   milliseconds) and documented in `DESIGN.md`. `tokens-guard.test.ts` rejects literal durations in `app.css`;
   `native-tokens.test.ts` rejects literal animation durations in Swift and Kotlin. The hand-written iOS `TranMotion`
   keeps its name and reads the generated duration; Android gets the same two-line helper, reading the animator
   duration scale for "reduce motion". No easing token: one `ease-out` is not a brand decision.
8. **Screenshots hang or refuse the transport, never a live API.** Web: a Playwright route that never fulfils
   (pending) or aborts with `connectionrefused` (fallback). Android: an OkHttp interceptor that sleeps on
   `Dispatchers.IO` (pending) or throws `IOException` (fallback) — the `Unconfined` dispatcher the other JVM
   screenshots use would block the main thread on a hang. iOS: the launch argument points at the RFC 5737 TEST-NET
   address `http://192.0.2.1:3001` (pending; ATS does not apply to IP addresses, the connect stalls until the 5 s
   timeout, three times) and at `http://127.0.0.1:1` (fallback, as today).

## Consequences

- One more section in `fixtures/feedback.json`; adding a source or changing the delay is one Rust edit, one fixture
  row and `pnpm tokens:sync` + `pnpm uniffi:generate`, and every platform goes red until it follows.
- REQ-WEB-006 is refined: the button is still disabled at once, but its progress label now follows the delay; the
  `App.test.tsx` assertion that reads "Checking…" synchronously moves behind an injected delay of `0`.
- Three new dictionary keys (`eligibility.result.updating`, `eligibility.result.sourceFallback`, plus the
  existing `sourceDevice` / `sourceServer` now referenced from the table) in `en`, `ne` and `hi`.
- The native screens gain a two-state model each (`ServerConfirmation`) with JVM / XCTest unit tests, so the
  cancellation and delay logic is tested without a simulator; the UI tests only assert what is visible.
- The e2e suite gains scenarios that stage a 1.5 s server delay; a few seconds of wall-clock per run.
- Not decided here: a minimum visible time, a progress indicator for the startup pill (it has nothing stale to show
  and already appears at once), and a total time budget per check beyond the retry policy.
