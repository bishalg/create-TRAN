# 011 Error handling and user feedback

Scope: how every failure and every notable outcome is classified, logged, retried and shown — in `crates/rust-core`
(the policy), `apps/api` (the envelope), `packages/*` (the TypeScript client) and the web, iOS and Android apps.
Rationale: [ADR-0028](../adr/0028-error-feedback-policy-in-rust.md). Golden cases: `fixtures/feedback.json`.

### REQ-ERR-001 [verified] One error catalogue, defined in Rust

Every failure MUST have a stable `code` (for example `validation.invalid_country_code`) from the catalogue in
`crates/rust-core/src/feedback.rs`. Each code MUST define its HTTP status (or none, for client-only failures), whether it
is retryable, its log level, how it is presented and the locale key of its message. TypeScript, Swift and Kotlin MUST
read the catalogue from generated files, and every implementation MUST pass `fixtures/feedback.json`.
**Verified by:** `crates/rust-core/tests/feedback_fixtures.rs`, `crates/tran-uniffi/tests/feedback_fixtures.rs`,
`packages/core-ts/tests/feedback.test.ts`, `FeedbackParityTests.swift`, `FeedbackParityTest.kt`.

### REQ-ERR-002 [verified] One error envelope with a code and a request id

Every API failure — rule violations, unreadable bodies, unknown routes (`404`) and wrong methods (`405`) — MUST be JSON
`{ "success": false, "error": "<developer message>", "code": "<catalogue code>", "retryable": <bool>, "request_id": "<id>" }`.
Every response MUST carry an `x-request-id` header equal to the body's `request_id`; a well-formed incoming
`x-request-id` MUST be reused.
**Verified by:** `apps/api/tests/api_test.rs` (`*_envelope*`, `request_id_*`).

### REQ-ERR-003 [verified] The server logs; it never leaks

Server failures (`5xx`) MUST respond with a generic message and log the real cause at `error` level with the request id.
Client failures (`4xx`) MUST be logged at the catalogue's level and never at `error`.
**Verified by:** `apps/api/src/error.rs` unit tests.

### REQ-ERR-004 [verified] Clients classify every failure

A client MUST take the `code` from the body when present; otherwise it MUST map the HTTP status with the catalogue's
fallback table (`429` rate limited, `502`/`503`/`504` unavailable, other `4xx` malformed request, other `5xx` internal).
No response at all MUST be `network.offline`; a timeout `network.timeout`; a caller abort `request.cancelled`.
**Verified by:** `packages/core-ts/tests/errors.test.ts`, `TranApiClientTests.swift`, `TranApiClientTests.kt`.

### REQ-ERR-005 [verified] Retry transient failures, then fall back

Only retryable codes on idempotent requests MAY be retried: at most 3 attempts in total, waiting
`half + random × half` where `half = min(2000, 200 × 2^(retry−1)) / 2` milliseconds, or the server's `Retry-After`
(capped at 2000 ms). When the attempts are spent the app MUST fall back — the eligibility verdict comes from the device
rules — instead of showing a dead end.
**Verified by:** `fixtures/feedback.json` `retryDelays` (Rust, UniFFI, TypeScript), `packages/core-ts/tests/feedback.test.ts`
(`withRetry`), `apps/web/src/shared/api/useTranApi.test.tsx`, native API client tests, BDD "A flaky server is
retried" and "A broken server is explained and the device answers instead".

### REQ-ERR-006 [verified] Each outcome has one presentation

The catalogue MUST assign exactly one presentation: `silent` (log only), `inline` (next to the field, until fixed),
`toast` (non-blocking, `success`/`info`/`warning`/`error`, `short` 3 s, `medium` 5 s or `long` 10 s, dismissible,
paused while hovered or focused), `banner` (persistent and non-blocking, removed when the condition clears) or `dialog`
(blocking, requires a choice). Validation is inline; connectivity loss is a banner; unexpected server errors are a long
error toast with a reference id; destructive actions are dialogs.
**Verified by:** `fixtures/feedback.json`, web atom tests (`TranToast`, `TranBanner`, `TranDialog`),
`FeedbackProvider.test.tsx`, native feedback parity tests, BDD `e2e/features/error-feedback.feature`.

### REQ-ERR-007 [verified] Destructive actions ask first

Signing out MUST open a confirmation dialog with Cancel and a destructive Sign out button. Cancel or Escape MUST keep
the session and return focus to the trigger; only Sign out ends the session.
**Verified by:** the screen scenarios "Signing out asks first and Cancel keeps the session" and "Confirming sign-out
returns to role selection", BDD "Cancelling sign-out with Escape keeps the session and restores focus", `TranDialog.test.tsx`,
`VotingUITests.swift`, `VotingHomeAccessibilityTest.kt`, Maestro `navigation-auth` flow.

### REQ-ERR-008 [verified] Success is acknowledged briefly

A completed server check MUST show a short (3 s) success toast with a check mark; it MUST NOT steal focus.
**Verified by:** BDD "A server check is acknowledged with a short toast", `TranToast.test.tsx`,
`FeedbackProvider.test.tsx`, native feedback parity tests.

### REQ-ERR-009 [verified] Users only see localized copy

Users MUST see the locale message for the error's code, never the server's or the core's English `error` text. A long
error toast for a server failure MUST show the request id as a reference.
**Verified by:** BDD "Server errors are explained in the user's language" and "A broken server is explained and the
device answers instead", `FeedbackProvider.test.tsx`, `App.test.tsx`, native copy tests.

### REQ-ERR-010 [verified] Authentication, permission and conflict failures have their own codes

`401` MUST classify as `auth.session_expired` (not retryable, `info`, a non-destructive dialog: "Sign in again" ends
the session and shows the sign-in screen, "Not now" keeps the screen so unsaved input is not lost). `403` MUST be
`auth.forbidden` (not retryable, `warn`, a medium error toast). `409` MUST be `request.conflict` (not retryable, `info`,
a medium warning toast). They MUST NOT fall into `request.malformed`. A dialog an error opens has its body and buttons in
one exhaustive table per platform, like action dialogs (REQ-ERR-007).
**Verified by:** `fixtures/feedback.json`, `crates/rust-core/tests/feedback_fixtures.rs`, `FeedbackProvider.test.tsx`, `App.errors.test.tsx`, `FeedbackPressureTests.swift`, `FeedbackPressureTest.kt`, BDD "An expired session asks to sign in again".

### REQ-ERR-011 [verified] A crash is caught, reported and recoverable where the platform allows it

A web render failure MUST be caught by one error boundary around the app and classified `client.render_failed`
(`error`, presentation `screen`: a full-page, focused, localized message with a Reload button — never a blank page).
Uncaught errors and unhandled promise rejections outside rendering MUST classify as `client.unexpected` and go through
`report` once. On iOS and Android an uncaught exception MUST be reported (REQ-ERR-014) and then handed to the
previous handler, which ends the process; SwiftUI and Compose cannot recover a broken view tree.
**Verified by:** `CrashBoundary.test.tsx`, `useGlobalErrors.test.tsx`, `App.errors.test.tsx`; native reporting in `TranReporting.swift` / `TranReporting.kt` (`FeedbackPressureTests.swift`, `FeedbackPressureTest.kt`).

### REQ-ERR-012 [verified] Toasts never pile up

At most `TOAST_POLICY.maxVisible` (3) toasts are visible; a new one evicts the oldest. A toast with the same message key
and tone as a visible one MUST restart that toast's timer (and update its reference id) instead of adding a copy.
The admission rule is one Rust function, pinned by `fixtures/feedback.json` `toastQueue` on every platform.
**Verified by:** `fixtures/feedback.json` `toastQueue` (`feedback_pressure_fixtures.rs` in rust-core and tran-uniffi, `resilience.test.ts`, native pressure tests), `FeedbackProvider.test.tsx`, BDD "A repeated failure shows one toast, not a pile".

### REQ-ERR-013 [verified] A connectivity banner recovers by itself

While a `banner` failure is shown the app MUST probe the server's health without retries: after
`RECOVERY_POLICY.firstProbeMs` (5 s), doubling up to `maxProbeMs` (60 s), and immediately when the platform reports
connectivity again (`online`) or the app returns to the foreground. A successful probe MUST clear the banner; probing
MUST stop when the banner clears or the screen goes away. The delays are pinned by `fixtures/feedback.json`
`recoveryProbes`.
**Verified by:** `fixtures/feedback.json` `recoveryProbes`, `recovery.test.ts`, `useTranApi.test.tsx`, `RecoveryProbeTests.swift`, `RecoveryProbeTest.kt`, BDD "The offline notice clears by itself when the network returns".

### REQ-ERR-014 [verified] Errors that need a human reach one reporter, without the payload

Every failure logged at `error` MUST also go to one pluggable reporter (none by default; Sentry, Crashlytics or an
HTTP sink in a real app) with exactly the `logEvent` fields. Only client-side codes (`client.*`) MAY attach the
thrown value for its stack. A reporter that throws MUST NOT break the app; failures below `error` MUST NOT be reported.
**Verified by:** `fixtures/feedback.json` `reportedLogLevels`, `resilience.test.ts`, `CrashBoundary.test.tsx`, native pressure tests.

### REQ-ERR-015 [verified] Cancelling during a retry wait settles at once

A caller's cancellation during a backoff wait MUST end the call immediately as `request.cancelled`, without waiting
for the delay or trying again.
**Verified by:** `resilience.test.ts` ("cancelling during a retry wait"); native waits are `Task.sleep` / `delay`, which cancellation ends at once.
