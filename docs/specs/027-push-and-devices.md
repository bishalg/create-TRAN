# 027 Push notifications and device registration

Scope: how the iOS app (`apps/ios`) and the Android app (`apps/android`) ask to send notifications, obtain a push
token and register it with the Axum API (`apps/api`); how the API keeps the device registry correct through sign-in,
token rotation, sign-out, account deletion and provider feedback; and what a notification may contain. The worked
example is "Notify me when I can vote", offered when the verdict is "not yet eligible". Builds on
[022](022-security.md) (sessions), [024](024-account-deletion.md) (erasure), [026](026-permissions-and-privacy.md)
(the permission catalogue and priming) and [011](011-error-feedback.md). Rationale:
[ADR-0044](../adr/0044-push-is-a-server-owned-registry.md). Playbook: [`../PUSH.md`](../PUSH.md).

Vocabulary used below:

- An **installation** is one install of the app on one device, named by a random **installation id** the app creates
  on first launch. It is not a hardware identifier and is new after a reinstall.
- A **push token** is the address the platform's push service (APNs, FCM) gives that installation. It changes over
  time and is not a secret, but it lets a server reach a device.
- A **registration** binds one installation and its current token to the signed-in user and the session it was made
  in.
- A notification is a **doorbell**: it says something happened; the app fetches what.

## The registry (API)

### REQ-PSH-001 [verified] A device registers its token to the signed-in user

`PUT /api/devices/{installation_id}` with a bearer token and
`{ "platform": "ios" | "android", "push_token", "environment": "sandbox" | "production", "locale", "app_version",
"marketing": false }` MUST create or replace that installation's registration, bound to the caller's user and session,
and answer `204`. The call MUST be idempotent. Without a valid token it answers `401` and stores nothing. The registry
sits behind a `DeviceStore` trait; the sample's is in memory. Inputs are validated strictly, and a failure answers
`400 request.malformed` naming the field, never its value: the installation id is a hyphenated version-4 UUID (either
case); `platform` and `environment` are closed sets, and Android is always `production`; an iOS token is even-length
hex of 64–200 characters (held lowercase), an Android token 32–1024 of `[A-Za-z0-9_:-]`; `locale` is a language tag of
at most 35 characters; `app_version` starts with a digit and has at most 32 of `[0-9A-Za-z.+-]`; `marketing` is
optional and `false` by default; unknown fields are refused. The routes get the session routes' `Origin` check and
`Cache-Control: no-store`, and CORS allows `PUT`.
**Verified by:** `apps/api/tests/devices_test.rs` (`register_*`, `foreign_origin_*`), `apps/api/src/devices.rs` unit
tests.

### REQ-PSH-002 [verified] One token belongs to one user

Registering a token that is already registered, to any installation of any user, MUST remove the older registration
first, so a phone handed to another person, or an app restored to a new device, cannot deliver one user's
notifications to another.
**Verified by:** `devices_test.rs` (`a_token_moves_to_its_newest_owner`), `device_store.rs` unit tests.

### REQ-PSH-003 [verified] Ending a session removes its registrations on the server

When a session is revoked (sign-out, a replayed refresh token, REQ-SEC-010 and REQ-SEC-011), every registration made
in that session MUST be removed in the same operation. When an account is deleted (REQ-ACC-001) every registration of
that user MUST be removed. Neither may depend on the device making another call. The session service (`Sessions`)
owns this tie, above both stores, so a fork replacing either store keeps it; a registration written for a session revoked
meanwhile is removed by the write itself. A durable fork makes each revocation and its removal one transaction, or
references the session row with `ON DELETE CASCADE` (the `DeviceStore` trait says so).
**Verified by:** `devices_test.rs` (`sign_out_*`, `replay_*`, `account_deletion_*`), `sessions.rs` and
`device_store.rs` unit tests.

### REQ-PSH-004 [verified] A device can unregister itself

`DELETE /api/devices/{installation_id}` with a bearer token MUST remove that installation's registration if it belongs
to the caller and answer `204` whether or not one existed. It MUST NOT remove another user's registration.
**Verified by:** `devices_test.rs`.

### REQ-PSH-005 [verified] Dead tokens are pruned by provider feedback and by age

Sending goes through a `PushSender` trait. When the provider reports a token as unregistered or invalid (APNs `410` /
`Unregistered`, `BadDeviceToken`; FCM `UNREGISTERED`, `INVALID_ARGUMENT` for the token), the API MUST remove that
registration. A registration not refreshed for `DEVICE_POLICY.stale_after_days` (`60`) MUST be removed by a prune the
API can run on a schedule: one refreshed exactly 60 days ago is stale. The policy numbers are Rust data. Every provider
reply maps onto one of four answers (`delivered`, `token dead`, `retry later`, `rejected`); only `token dead` removes a
registration, and only while it still holds that token, so a token renewed since is kept. `INVALID_ARGUMENT` from FCM
counts as dead only when the error names `message.token`. The real senders, `ApnsSender` (HTTP/2, an ES256 provider
token reused for 50 minutes) and `FcmSender` (FCM v1, an OAuth access token from the service account, reused until five
minutes before it expires), map their replies with the same tested functions (ADR-0046). Each is on only when all its
variables are set (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_TOPIC`; `FCM_SERVICE_ACCOUNT_JSON`); with none
set, a send for that platform answers `not configured`, which never removes a registration, and one start-up line says
which providers are on. A provider half configured, or a key that does not parse, stops start-up with a message naming
the variable, never its value.
**Verified by:** `apps/api/tests/push_test.rs` (`provider_*`, `prune_*`) with a fake sender; `device_store.rs` unit tests on the
injected clock; `apps/api/src/push/sender.rs` unit tests (the reply mappings); `apps/api/tests/push_senders_test.rs`
(`apns_*`, `fcm_*`: the JWTs over throwaway keys, request shapes, token reuse, every `providerReplies` row of
`fixtures/push.json`, against a local fake provider); `apps/api/tests/push_providers_test.rs` (`provider_*`:
configuration, the start-up line, a dead token removed end to end, no secret in a log). The two live sends are
`apps/api/tests/push_live_test.rs`, skipped with `TODO(credentials)` until a fork sets its credentials.

### REQ-PSH-006 [verified] A notification payload carries no personal data

The payload builder MUST be a pure function producing the APNs and FCM v1 bodies from a notification type and an
opaque id: a localized title and body chosen by key and arguments from the dictionaries, never free text from user
data; no name, email, verdict detail or token. A collapse key MUST be set so repeats replace each other. A
notification marked marketing MUST be sent only to registrations with `marketing: true`. The API chooses the text from
the dictionaries in the registration's `locale` (the tag, then its language, then English), because APNs resolves a
`loc-key` only in an app's `Localizable` table, which the iOS app does not have; the text is the same fixed sentence for
everyone. The opaque id is 1–64 of `[A-Za-z0-9_-]`. The provider address (the APNs device path, FCM's `message.token`)
is added by the sender and is never part of a body. The sample's one type is `eligibility.reached`, collapse key
`eligibility.reached`.
**Verified by:** `apps/api/src/push/payload.rs` unit tests, the `payloads` and `marketing` sections of
`fixtures/push.json`, `push_test.rs` (`provider_*`).

### REQ-PSH-007 [verified] The registry never appears in a log or an error

No log line or error body may contain a push token or an installation id. Registry events log the fixed fields only.
The request span logs a device path as `/api/devices/{installation_id}`.
**Verified by:** rows `FM-A09` to `FM-A14` in `fixtures/failure-modes.json`; `devices_test.rs` (`logs_*`);
`middleware/auth_origin.rs` unit tests.

## The clients

### REQ-PSH-008 [verified] Notification permission follows the permission rules

`notifications` MUST be an entry in the permission catalogue (REQ-PRV-001) and be asked only from
`notify-me-button`, shown with a "not yet eligible" verdict, after priming (REQ-PRV-003). A refusal MUST leave the
verdict and every other feature unchanged (REQ-PRV-004). No notification permission may be requested at launch or at
sign-in. iOS asks without a usage description, so the entry declares only Android's `POST_NOTIFICATIONS`. The control
is native only, present in state `not_yet_eligible` (a below-minimum verdict, in a build with push), with the priming
(`notify-priming-continue`, `notify-priming-dismiss`) and the Settings note (`notify-settings-note`,
`notify-open-settings`) of the location control. A scenario stages push as available only through a `permission` given
naming `notifications`; without it the debug apps report push unavailable.
**Verified by:** the platform notification-permission tests; scenarios "Asking to be notified explains first" and
"Asking to be notified without permission keeps the verdict".

### REQ-PSH-009 [verified] What to do with a token is one Rust decision

`push_sync(state) -> action` MUST be defined in Rust and pinned by `fixtures/push.json`: with permission granted, an
API session and a token that differs from the last one registered → `register`; token unchanged and registered less
than `DEVICE_POLICY.refresh_after_days` (`7`) ago → `nothing`; permission no longer granted, or no API session, while a
registration is recorded → `unregister`; otherwise `nothing`. Clients MUST run it at launch, on return to the
foreground, when the platform delivers a new token, and after sign-in. The state is push available (the build is
configured), permission granted, an API session, the current token (or none yet), the recorded registration (token and
time) and now, in Unix seconds on the device clock. Push unavailable counts like a refused permission. With no token
yet, nothing is done and a recorded registration is kept. An unchanged token registered `refresh_after_days` ago or
more, or dated in the future (the clock moved back), → `register`.
**Verified by:** `crates/rust-core/tests/push_fixtures.rs`, `crates/tran-uniffi/tests/push_fixtures.rs`,
`PushParityTests.swift`, `PushParityTest.kt`.

### REQ-PSH-010 [verified] The installation id is random, local and not a credential

The app MUST create the installation id with the platform's random UUID on first launch and keep it in ordinary app
storage. It MUST NOT be derived from hardware (no IDFV, `ANDROID_ID`, serial or MAC) and MUST NOT be sent anywhere
except the device routes. Two devices MUST NOT share one installation id: Android excludes it from backup and device transfer; iOS, which
cannot exclude a single preference, binds it to the device's push token and replaces it when the token differs.
**Verified by:** platform unit tests; `packages/core-ts/tests/push-guards.test.ts` (no hardware identifier).

### REQ-PSH-011 [verified] Sign-out unregisters, and still works offline

On sign-out the client MUST clear its recorded registration and make a best-effort `DELETE` before the session ends;
the guarantee is REQ-PSH-003, so a failed or skipped call MUST NOT keep the user signed in or leave the device
reachable.
**Verified by:** the platform session and push tests.

### REQ-PSH-012 [verified] Tokens come from a gateway, and the app builds without push configured

Only one file per platform may call the push-registration APIs (`registerForRemoteNotifications` and the notification
center delegate on iOS; the FCM messaging API on Android): `apps/ios/Sources/TranVotingDemo/Push/SystemPushGateway.swift`
and `apps/android/app/src/main/kotlin/com/tran/voting/push/SystemPushGateway.kt`. The notification permission itself is
asked by `Permissions/SystemPermissionGateway` like every other permission. When push is not configured for the build (no APNs entitlement; no FCM values), the gateway MUST report push as
unavailable, `notify-me-button` MUST NOT be shown, and the app MUST build, run and pass every suite.
**Verified by:** `packages/core-ts/tests/push-guards.test.ts`; the platform tests with the unavailable gateway.

### REQ-PSH-013 [verified] A tap on a notification goes through the navigation director

Opening the app from a notification MUST route through `resolve_destination` with the stored session, never straight
to a screen: signed out leads to Auth Welcome. A notification received in the foreground MUST be presented as an
in-app toast from the catalogue (the `notification_received` action), not as a system banner over the app.
**Verified by:** the platform notification-handling tests.
