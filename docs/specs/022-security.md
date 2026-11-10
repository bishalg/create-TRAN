# 022 Security: secrets, sessions and sensitive data

Scope: how configuration and secrets are kept out of the repository and out of client binaries; how the Axum API
(`apps/api`) issues, rotates and revokes a session; where the web app (`apps/web`), iOS (`apps/ios`) and Android
(`apps/android`) keep the credentials they are given; and what must never be logged, cached or shown. Builds on
[002](002-http-api.md) (CORS, configuration), [006](006-navigation-auth-flow.md) (the session decides the destination),
[011](011-error-feedback.md) (`auth.session_expired`, `auth.forbidden`), [012](012-failure-modes.md) (nothing leaks in
a failure) and [016](016-supply-chain.md) (dependencies). Rationale and threat model:
[ADR-0039](../adr/0039-sessions-tokens-and-secret-storage.md). How-to for a fork: [`../SECURITY.md`](../SECURITY.md).

Vocabulary used below:

- A **secret** is a value whose disclosure lets someone act as the server or as a user: a private key, a provider API
  key, a password, a token. A **public setting** is anything else (a URL, a port, a feature flag).
- The **access token** is the short-lived bearer credential sent on API calls. The **refresh token** is the long-lived
  credential that buys a new pair. A **session** is one sign-in: every token descended from it (its _family_).
- The **vault** is the one place a platform persists the refresh token: the Keychain on iOS, a Keystore-encrypted
  record on Android, an `HttpOnly` cookie on the web.
- The sample's sign-in has **no credential check**: choosing a role is the whole "login". Everything after that point
  is real. A fork puts its password, passkey or OIDC verification in front of `POST /api/auth/session`.

## Secrets and configuration

### REQ-SEC-001 [verified] No secret is committed

`.env` and `.env.*` MUST be ignored by git, except `.env.example`. `pnpm secrets:check` MUST scan every tracked file
for private-key blocks and well-known provider token shapes (GitHub, AWS, Anthropic, OpenAI, Stripe, Slack, Google) and
fail on a match; with `--staged` it MUST scan only the staged content. An exception MUST be an entry in
`tooling/secrets/allow.json` naming the file, the matched rule and a reason; an entry that no longer matches anything
MUST fail the check. The check MUST run in the `pre-commit` hook, in `pnpm check:quick` and in CI.
**Verified by:** `tooling/secrets/secrets.test.mjs`; the hook and workflow assertions in the same file.

### REQ-SEC-002 [verified] `.env.example` is the configuration contract

Every environment variable the code reads (the API's config lookup, `import.meta.env.VITE_*` in the web app) MUST be
listed in `.env.example` with a comment, and every variable listed there MUST be read by code. Values in `.env.example`
MUST be safe local defaults or empty, never a real credential. `pnpm secrets:check` MUST fail on a variable missing
from either side.
**Verified by:** `tooling/secrets/secrets.test.mjs`.

### REQ-SEC-003 [verified] Whatever ships to a client is public

A value compiled into a client is readable by anyone who downloads it. A `VITE_*` variable, an Android `BuildConfig`
field and a custom iOS `Info.plist` key MUST NOT have a name containing `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`,
`CREDENTIAL` or `API_KEY` (any case, with or without the underscore). `pnpm secrets:check` MUST fail on one.
**Verified by:** `tooling/secrets/secrets.test.mjs`.

### REQ-SEC-004 [verified] A secret in memory cannot be printed by accident

The API MUST hold every token and any future configuration secret in a `Secret` wrapper whose `Debug` and `Display`
print `[redacted]`, which does not implement `Serialize`, and whose value is reachable only through an explicit
`expose()` call.
**Verified by:** unit tests in `apps/api/src/secret.rs`.

## The API session

### REQ-SEC-005 [verified] Session policy is Rust data

`crates/rust-core/src/session.rs` MUST define `SESSION_POLICY`: access-token lifetime `900` s, refresh-token lifetime
`2 592 000` s (30 days) and token entropy `32` bytes. The API MUST read these numbers from it; TypeScript MUST receive
them only through `pnpm tokens:sync` (ADR-0027) and native code only through UniFFI.
**Verified by:** `session.rs` unit tests, the `policy` section of `fixtures/session.json` on every platform.

### REQ-SEC-006 [verified] Sign-in issues an opaque token pair

`POST /api/auth/session` with `{ "role": "citizen_voter" | "election_auditor", "transport": "cookie" | "body" }` MUST
answer `201` with `{ "access_token", "token_type": "Bearer", "expires_in", "user": { "user_id", "role" } }`. Each token
MUST be `SESSION_POLICY.token_bytes` bytes from the operating system's CSPRNG, encoded as unpadded base64url. The
server MUST keep only the SHA-256 digest of each token, behind a `SessionStore` trait whose in-memory implementation is
the sample's. An unknown role or transport is `400` in the envelope of REQ-API-003.
**Verified by:** `apps/api/tests/auth_test.rs`, `session_store.rs` unit tests.

### REQ-SEC-007 [verified] The refresh token travels by exactly one transport

With `transport: "cookie"` the refresh token MUST be sent only as
`Set-Cookie: tran_refresh=<token>; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=<refresh lifetime>`, with
`Secure` added whenever `APP_ENV` is not `development` or `test`, and MUST NOT appear in any response body. With
`transport: "body"` it MUST be the `refresh_token` field of the JSON body and no cookie is set. A session keeps its
transport for life: a refresh presented by cookie is answered by cookie, one presented in the body is answered in the
body.
**Verified by:** `auth_test.rs` (`cookie_transport_*`, `body_transport_*`).

### REQ-SEC-008 [verified] Bearer authentication gives one answer to every bad token

`GET /api/auth/session` with `Authorization: Bearer <access token>` MUST answer `200` with `{ "user_id", "role" }`. A
missing header, another scheme, a malformed, unknown, revoked or expired token MUST all answer the same `401` with code
`auth.session_expired` and `WWW-Authenticate: Bearer`. Expiry MUST be measured on the injected clock (ADR-0004).
**Verified by:** `auth_test.rs` (`bearer_*`).

### REQ-SEC-009 [verified] Refresh rotates the pair

`POST /api/auth/refresh` with a valid refresh token (cookie, or `{ "refresh_token" }` in the body) MUST answer `200`
with a new access token, a new refresh token on the same transport and the `user` object, and MUST invalidate the
refresh token it was given; the previous access token stays valid until it expires or its session is revoked. A missing, unknown or expired refresh token MUST answer `401` `auth.session_expired`; on the
cookie transport that answer MUST also clear the cookie (`Max-Age=0`).
**Verified by:** `auth_test.rs` (`refresh_*`).

### REQ-SEC-010 [verified] A replayed refresh token ends the session

Presenting a refresh token that was already rotated MUST revoke the whole session: the request answers `401`, and every
access and refresh token of that family answers `401` from then on.
**Verified by:** `auth_test.rs` (`replayed_refresh_token_revokes_the_family`).

### REQ-SEC-011 [verified] Sign-out revokes on the server

`POST /api/auth/sign-out` with a refresh token (cookie or body) MUST revoke its family, clear the cookie on the cookie
transport and answer `204`. It MUST answer `204` for a missing or unknown token too, so it reveals nothing and is safe
to repeat.
**Verified by:** `auth_test.rs` (`sign_out_*`).

### REQ-SEC-012 [verified] Auth endpoints reject a foreign origin

A request to `/api/auth/*` (or to `/api/account`, REQ-ACC-001) whose `Origin` header is present and not in the CORS
allowlist (REQ-API-007) MUST answer `403` `auth.forbidden` and change nothing. A request without `Origin` (a native
client, a server) is not affected.
**Verified by:** `auth_test.rs` (`foreign_origin_*`), `account_test.rs` (`foreign_origin_cannot_delete_the_account`).

### REQ-SEC-013 [verified] Every API response carries the security headers

Every response MUST carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. When `APP_ENV` is not `development` or
`test` it MUST also carry `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Every `/api/auth/*` and
`/api/account` response MUST carry `Cache-Control: no-store`.
**Verified by:** `apps/api/tests/security_headers_test.rs`.

### REQ-SEC-014 [verified] Tokens never reach a log, an error body or a report

No log line and no error envelope the API writes may contain an access or refresh token, an `Authorization` value or a
cookie value, in success or in failure. Client log events and reporter events (REQ-ERR-012) are held to the same rule
on every platform.
**Verified by:** `auth` rows with `must_not_leak` in `fixtures/failure-modes.json` (`apps/api/tests/failure_modes.rs`);
the session-client tests on each platform assert the captured log events.

## The client session

### REQ-SEC-015 [verified] What to do after an auth failure is one Rust decision

`crates/rust-core/src/session.rs` MUST define `session_recovery(event) -> action`, pinned by the `recovery` section of
`fixtures/session.json`, and `refresh_event(status)`, which names the outcome of a refresh call (`refreshResponses`
section: `2xx` is success, `401` and `403` are a rejection, everything else including no answer is a failure):

| Event                                                                 | Action     | Meaning                                                 |
| :-------------------------------------------------------------------- | :--------- | :------------------------------------------------------ |
| `401` on an API call, a refresh credential is held, not yet retried   | `refresh`  | Refresh once, then repeat the call with the new token   |
| `401` on an API call, no refresh credential, or already retried       | `sign_out` | Clear the vault and present `auth.session_expired`      |
| The refresh call answers `401` or `403`                               | `sign_out` | The credential is dead; clear it                        |
| The refresh call fails any other way (network, timeout, `5xx`, `429`) | `keep`     | Keep the credential and the device session; retry later |

iOS and Android MUST call it through UniFFI; the TypeScript mirror MUST pass the fixture.
**Verified by:** `crates/rust-core/tests/session_fixtures.rs`, `crates/tran-uniffi/tests/session_fixtures.rs`,
`packages/core-ts/tests/session.test.ts`, `SessionParityTests.swift`, `SessionParityTest.kt`.

### REQ-SEC-016 [verified] One refresh at a time

When several API calls fail with `401` at once, a client MUST send one refresh request, and each call MUST repeat once
with the token that request returned. (Two parallel refreshes would trip REQ-SEC-010 and end the session.)
**Verified by:** `packages/api/tests/session-client.test.ts`, `SessionClientTests.swift`, `SessionClientTest.kt`.

### REQ-SEC-017 [verified] The access token lives in memory only

No platform may persist the access token (disk, Web Storage, Keychain, preferences) or put any token in a URL. After a
restart a client obtains a new one by refreshing.
**Verified by:** the session-client tests on each platform; the storage guards of REQ-SEC-018 to REQ-SEC-020.

### REQ-SEC-018 [verified] The web app holds no credential a script can read

The web app MUST request `transport: "cookie"`, MUST send `credentials: 'include'` only on `/api/auth/*` requests and
`credentials: 'omit'` on every other one, and MUST NOT write a token or a session to `localStorage`, `sessionStorage`,
IndexedDB or `document.cookie`. A guard test MUST fail when Web Storage is used outside the theme preference module.
**Verified by:** `packages/api/tests/session-client.test.ts`, `apps/web/tests/web-storage-guard.test.ts`.

### REQ-SEC-019 [verified] iOS keeps the session in the Keychain

iOS MUST persist the refresh token with the user id and role as one generic-password Keychain item, accessible
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and not synchronizable, behind a `SessionVault` protocol with an
in-memory double for tests. `UserDefaults` MUST NOT hold any of it. Because Keychain items survive an uninstall, the
first launch after an install MUST delete any item left by a previous install.
**Verified by:** `KeychainSessionVaultTests.swift`, `SessionVaultGuardTests.swift`.

### REQ-SEC-020 [verified] Android keeps the session under a Keystore key

Android MUST encrypt the same record with AES-256-GCM under a non-exportable key in the Android Keystore, with a new IV
for every write, and store only ciphertext in app-private preferences, behind a `SessionVault` interface with an
in-memory double for tests. A record that cannot be decrypted MUST be deleted and treated as signed out. The manifest
MUST set `android:allowBackup="false"` and data-extraction rules that exclude the vault from cloud backup and device
transfer.
**Verified by:** `KeystoreSessionVaultTest.kt` (instrumented), `SessionVaultGuardTest.kt`, `native-networking.test.ts`
(manifest).

### REQ-SEC-021 [verified] Launch restores the stored session

On launch the native Splash MUST read the vault and route with `resolve_destination` without waiting for the network,
then validate the session against `GET /api/auth/session` in the background and act per REQ-SEC-015. The web app MUST
call `POST /api/auth/refresh` on boot: success restores the session and its destination, anything else leads to Auth
Welcome. An unreachable API MUST NOT sign a native user out.
**Verified by:** `SessionRestoreTests.swift`, `SessionRestoreTest.kt`, `apps/web/tests/session-restore.test.tsx`.

### REQ-SEC-022 [verified] Sign-out clears the device first

Signing out MUST clear the vault and the in-memory access token before, and regardless of, the call to
`POST /api/auth/sign-out`; a failed or unreachable server call MUST NOT keep the user signed in.
**Verified by:** the session-client tests on each platform.

### REQ-SEC-023 [verified] The app switcher shows no user data

While a signed-in screen is on display, iOS MUST cover the window whenever the scene is not active, and Android MUST
keep the content out of the recents thumbnail (`setRecentsScreenshotEnabled(false)`; the floor is API 33, ADR-0045). Debug screenshot runs MAY switch the Android measure off by a launch flag that a release build ignores.
**Verified by:** `PrivacyCoverTests.swift`, `PrivacyShieldTest.kt` (the decision and its wiring; the system app switcher
itself cannot be captured by a UI test).

### REQ-SEC-024 [verified] The built web app declares a Content Security Policy

The production `index.html` MUST carry a CSP `<meta>` equivalent to: `default-src 'self'`; `script-src 'self'` plus the
SHA-256 hash of each inline script; `connect-src 'self'` plus the configured API origin; `object-src 'none'`;
`base-uri 'self'`; `form-action 'self'`. The hash MUST be computed at build time, and the release smoke run MUST fail
on any CSP violation reported by the browser. (`frame-ancestors` cannot be set by `<meta>`; the host's response
headers own it, see `docs/SECURITY.md`.)
**Verified by:** `apps/web/tests/csp-plugin.test.ts`, `e2e/smoke/release.spec.ts`.
