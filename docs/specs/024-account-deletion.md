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

### REQ-ACC-001 [planned] The API deletes the caller's account

`DELETE /api/account` with a valid bearer token MUST erase the caller's data through an `AccountEraser` trait, revoke
every session of that user (all devices), clear the refresh cookie on the cookie transport, and answer `204`. Without a
valid token it MUST answer `401` `auth.session_expired` and erase nothing. The route is under the `Origin` check of
REQ-SEC-012 and answers `Cache-Control: no-store`.
**Verified by:** `apps/api/tests/account_test.rs`.

### REQ-ACC-002 [planned] Deletion revokes every session of the user

After a successful deletion, every access and refresh token issued to that user before it, on any device and either
transport, MUST answer `401`. Sessions of other users MUST be unaffected.
**Verified by:** `account_test.rs` (`deletion_revokes_every_session_of_the_user`), `session_store.rs` unit tests.

### REQ-ACC-003 [planned] Deletion leaves an audit event and nothing else

A deletion MUST log one `info` event, `account deleted`, with the `request_id` only: no user id, no token. No other
record of the account may remain in the store.
**Verified by:** `account_test.rs` (`deletion_is_logged_without_identity`).

### REQ-ACC-004 [planned] The action is in the app, next to sign-out

Every signed-in screen MUST offer a "Delete account" control, declared once in the screen contract
(`delete-account-button`) and present on web, iOS and Android. It MUST NOT be hidden behind a link to a website, an
email address or a support form.
**Verified by:** the screen contract (`pnpm screens:check`), scenario "Deleting the account asks first".

### REQ-ACC-005 [planned] Deletion asks first, and says it is permanent

`UserAction::DeleteAccount` MUST be a `dialog` confirmation in the Rust catalogue (REQ-ERR-007). Its copy MUST say the
account and its data are deleted permanently and cannot be recovered; the confirming button MUST name the action
("Delete account"), and Cancel MUST change nothing.
**Verified by:** `fixtures/feedback.json` action rows on every platform; scenarios "Deleting the account asks first and
Cancel keeps it" and "Confirming deletes the account and returns to role selection".

### REQ-ACC-006 [planned] The device is cleared only after the server confirms

On `204` the client MUST clear the vault and the in-memory token, return to Auth Welcome and acknowledge with a
success toast. On any failure (offline, timeout, `5xx`) it MUST keep the session, change nothing on the device and
present the failure through the normal error feedback, because an account that only looks deleted is worse than an
error. A `401` during deletion follows REQ-SEC-015 like any other call.
**Verified by:** `packages/api/tests/session-client.test.ts`, `SessionClientTests.swift`, `SessionClientTest.kt`; the
scenario "A deletion that cannot reach the server keeps the account".

### REQ-ACC-007 [planned] A public page explains deletion without the app

The web app MUST serve `/account-deletion.html`, reachable without signing in and without the app installed, stating
how to delete the account, what is deleted, what is kept and for how long (the sample keeps nothing), and linking to
the web app where the action can be performed. The page MUST be localized like the rest of the app and pass the
accessibility audit.
**Verified by:** `e2e/features/account-deletion.feature`, the a11y audit.
