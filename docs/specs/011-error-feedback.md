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
**Verified by:** BDD "Signing out asks for confirmation", "Cancelling sign-out keeps the session", `TranDialog.test.tsx`,
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
