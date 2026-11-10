# 024 Account deletion

Scope: how a signed-in person deletes their account from the web app (`apps/web`), iOS (`apps/ios`) and Android
(`apps/android`), what the Axum API (`apps/api`) erases, and the public page the stores ask for. Builds on
[022](022-security.md) (sessions, the vault), [011](011-error-feedback.md) (destructive actions ask first) and
[021](021-screen-contract.md) (declared elements and scenarios). Rationale:
[ADR-0041](../adr/0041-account-deletion.md). Playbook: [`../ACCOUNT_DELETION.md`](../ACCOUNT_DELETION.md).

Vocabulary used below:

- **Deleting** an account removes the account and its data for good. **Signing out** only ends a session. The two are
  separate actions with separate confirmations.
- The sample's accounts are the demo users of spec 022 (one per role). Deleting one erases everything the server holds
  for it, which here is its sessions; signing in again creates it anew. A fork erases its own tables at the same seam.

### REQ-ACC-001 [verified] The API deletes the caller's account

`DELETE /api/v1/account` with a valid bearer token MUST erase the caller's data through an `AccountEraser` trait, revoke
every session of that user (all devices), send the header that clears the refresh cookie on the cookie transport, and
answer `204`. That request carries no cookie (REQ-SEC-018), so a browser ignores the header: a browser client follows a
successful deletion with the best-effort `POST /api/v1/auth/sign-out`, which carries the cookie and removes it. Without a
valid token it MUST answer `401` `auth.session_expired` and erase nothing. If the eraser fails it MUST answer `500`
`server.internal` with every session intact. The route is under the `Origin` check of REQ-SEC-012 and answers
`Cache-Control: no-store`.
**Verified by:** `apps/api/tests/account_test.rs`, the `FM-A08` row of `fixtures/failure-modes.json`.

### REQ-ACC-002 [verified] Deletion revokes every session of the user

After a successful deletion, every access and refresh token issued to that user before it, on any device and either
transport, MUST answer `401`. Sessions of other users MUST be unaffected.
**Verified by:** `account_test.rs` (`deletion_revokes_every_session_of_the_user`), `session_store.rs` unit tests
(`revoking_a_user_ends_every_session_of_that_user_only`).

### REQ-ACC-003 [verified] Deletion leaves an audit event and nothing else

A deletion MUST log one `info` event, `account deleted`, with the `request_id` only (beside the request span's fixed
`method` and `path`): no user id, no role, no token. No other record of the account may remain in the store.
**Verified by:** `account_test.rs` (`deletion_is_logged_without_identity`), `session_store.rs`
(`revoking_a_user_leaves_no_record_of_them`).

### REQ-ACC-004 [verified] The action is in the app, next to sign-out

Every signed-in screen MUST offer a "Delete account" control, declared once in the screen contract
(`delete-account-button`) and present on web, iOS and Android. It MUST NOT be hidden behind a link to a website, an
email address or a support form.
**Verified by:** the screen contract (`pnpm screens:check`), scenarios "Deleting the account asks first and Cancel keeps
it" and "Deleting the account from the auditor dashboard asks first and Cancel keeps it".

### REQ-ACC-005 [verified] Deletion asks first, and says it is permanent

`UserAction::DeleteAccount` MUST be a `dialog` confirmation in the Rust catalogue (REQ-ERR-007). Its copy MUST say the
account and its data are deleted permanently and cannot be recovered; the confirming button MUST name the action
("Delete account"), and Cancel MUST change nothing.
**Verified by:** `fixtures/feedback.json` action rows on every platform; the scenario "Deleting the account asks first
and Cancel keeps it". Confirming is not a scenario: the native suites run without an API and their stored-session
given holds no token, so no verb stages a deletion the server confirms on all three platforms. Each platform's
session-client and UI tests prove that confirming deletes the account and returns to role selection.

### REQ-ACC-006 [verified] The device is cleared only after the server confirms

On `204` the client MUST clear the vault and the in-memory token, return to Auth Welcome and acknowledge with the
catalogue's success toast (`UserAction::AccountDeleted`, `auth.accountDeleted`). On any failure (offline, timeout,
`5xx`) it MUST keep the session, change nothing on the device and present the failure through the normal error
feedback, because an account that only looks deleted is worse than an error. A `401` during deletion follows REQ-SEC-015 like any other call. While a deletion is in flight the control MUST NOT start another.
**Verified by:** `packages/api/tests/session-client.test.ts`, `SessionClientTests.swift`, `SessionClientTest.kt` (the
`204` path, which no scenario stages); the scenario "A deletion that cannot reach the server keeps the account".

### REQ-ACC-007 [verified] A public page explains deletion without the app

The web app MUST serve `/account-deletion.html`, reachable without signing in and without the app installed, stating
how to delete the account, what is deleted, what is kept and for how long (the sample keeps nothing), and linking to
the web app where the action can be performed. The page MUST be localized like the rest of the app and pass the
accessibility audit.
**Verified by:** `e2e/features/account-deletion.feature`, the a11y audit.
