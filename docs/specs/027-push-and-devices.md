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

### REQ-PSH-001 [planned] A device registers its token to the signed-in user

`PUT /api/devices/{installation_id}` with a bearer token and
`{ "platform": "ios" | "android", "push_token", "environment": "sandbox" | "production", "locale", "app_version",
"marketing": false }` MUST create or replace that installation's registration, bound to the caller's user and session,
and answer `204`. The call MUST be idempotent. Without a valid token it answers `401` and stores nothing. The registry
sits behind a `DeviceStore` trait; the sample's is in memory.
**Verified by:** `apps/api/tests/devices_test.rs`.

### REQ-PSH-002 [planned] One token belongs to one user

Registering a token that is already registered, to any installation of any user, MUST remove the older registration
first, so a phone handed to another person, or an app restored to a new device, cannot deliver one user's
notifications to another.
**Verified by:** `devices_test.rs` (`a_token_moves_to_its_newest_owner`), `device_store.rs` unit tests.

### REQ-PSH-003 [planned] Ending a session removes its registrations on the server

When a session is revoked (sign-out, a replayed refresh token, REQ-SEC-010 and REQ-SEC-011), every registration made
in that session MUST be removed in the same operation. When an account is deleted (REQ-ACC-001) every registration of
that user MUST be removed. Neither may depend on the device making another call.
**Verified by:** `devices_test.rs` (`sign_out_*`, `replay_*`, `account_deletion_*`).

### REQ-PSH-004 [planned] A device can unregister itself

`DELETE /api/devices/{installation_id}` with a bearer token MUST remove that installation's registration if it belongs
to the caller and answer `204` whether or not one existed. It MUST NOT remove another user's registration.
**Verified by:** `devices_test.rs`.

### REQ-PSH-005 [planned] Dead tokens are pruned by provider feedback and by age

Sending goes through a `PushSender` trait. When the provider reports a token as unregistered or invalid (APNs `410` /
`Unregistered`, `BadDeviceToken`; FCM `UNREGISTERED`, `INVALID_ARGUMENT` for the token), the API MUST remove that
registration. A registration not refreshed for `DEVICE_POLICY.stale_after_days` (`60`) MUST be removed by a prune the
API can run on a schedule. The policy numbers are Rust data.
**Verified by:** `devices_test.rs` with a fake sender; `device_store.rs` unit tests on the injected clock.

### REQ-PSH-006 [planned] A notification payload carries no personal data

The payload builder MUST be a pure function producing the APNs and FCM v1 bodies from a notification type and an
opaque id: a localized title and body chosen by key and arguments from the dictionaries, never free text from user
data; no name, email, verdict detail or token. A collapse key MUST be set so repeats replace each other. A
notification marked marketing MUST be sent only to registrations with `marketing: true`.
**Verified by:** `apps/api/src/push/payload.rs` unit tests, `fixtures/push.json`.

### REQ-PSH-007 [planned] The registry never appears in a log or an error

No log line or error body may contain a push token or an installation id. Registry events log the fixed fields only.
**Verified by:** rows in `fixtures/failure-modes.json`; `devices_test.rs` log assertions.

## The clients

### REQ-PSH-008 [planned] Notification permission follows the permission rules

`notifications` MUST be an entry in the permission catalogue (REQ-PRV-001) and be asked only from
`notify-me-button`, shown with a "not yet eligible" verdict, after priming (REQ-PRV-003). A refusal MUST leave the
verdict and every other feature unchanged (REQ-PRV-004). No notification permission may be requested at launch or at
sign-in.
**Verified by:** the platform notification-permission tests; scenario "Asking to be notified explains first".

### REQ-PSH-009 [planned] What to do with a token is one Rust decision

`push_sync(state) -> action` MUST be defined in Rust and pinned by `fixtures/push.json`: with permission granted, an
API session and a token that differs from the last one registered → `register`; token unchanged and registered less
than `DEVICE_POLICY.refresh_after_days` (`7`) ago → `nothing`; permission no longer granted, or no API session, while a
registration is recorded → `unregister`; otherwise `nothing`. Clients MUST run it at launch, on return to the
foreground, when the platform delivers a new token, and after sign-in.
**Verified by:** `crates/rust-core/tests/push_fixtures.rs`, `crates/tran-uniffi/tests/push_fixtures.rs`,
`PushParityTests.swift`, `PushParityTest.kt`.

### REQ-PSH-010 [planned] The installation id is random, local and not a credential

The app MUST create the installation id with the platform's random UUID on first launch and keep it in ordinary app
storage. It MUST NOT be derived from hardware (no IDFV, `ANDROID_ID`, serial or MAC) and MUST NOT be sent anywhere
except the device routes.
**Verified by:** platform unit tests; a source guard against hardware identifiers.

### REQ-PSH-011 [planned] Sign-out unregisters, and still works offline

On sign-out the client MUST clear its recorded registration and make a best-effort `DELETE` before the session ends;
the guarantee is REQ-PSH-003, so a failed or skipped call MUST NOT keep the user signed in or leave the device
reachable.
**Verified by:** the platform session and push tests.

### REQ-PSH-012 [planned] Tokens come from a gateway, and the app builds without push configured

Only one file per platform may call the push-registration APIs (`registerForRemoteNotifications`; the FCM messaging
API). When push is not configured for the build (no APNs entitlement; no FCM values), the gateway MUST report push as
unavailable, `notify-me-button` MUST NOT be shown, and the app MUST build, run and pass every suite.
**Verified by:** a source guard; the platform tests with the unavailable gateway.

### REQ-PSH-013 [planned] A tap on a notification goes through the navigation director

Opening the app from a notification MUST route through `resolve_destination` with the stored session, never straight
to a screen: signed out leads to Auth Welcome. A notification received in the foreground MUST be presented as an
in-app toast from the catalogue, not as a system banner over the app.
**Verified by:** the platform notification-handling tests.
