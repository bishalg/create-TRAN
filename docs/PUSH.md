# Push and device registration playbook

What it is: asking to notify, getting a push token, keeping the server's list of devices correct, and deciding what a
notification may say. Why it is here: a token left registered after sign-out sends one person's notifications to
another, and prompting at launch or sending marketing without opt-in gets an app rejected (Apple 4.5.4). Rules:
[spec 027](./specs/027-push-and-devices.md). Reasons: [ADR-0044](./adr/0044-push-is-a-server-owned-registry.md).

## The rules

1. **Ask in context**, after priming, from the feature that needs it. Never at launch. The app works without it.
2. **Register to the signed-in user and session.** No session, no registration.
3. **The server removes registrations** when the session ends: sign-out, replayed token, account deletion. The client
   also tries, but nothing depends on it.
4. **One token, one user.** A new registration of a token deletes the old one.
5. **Re-run the sync** at launch, on foreground, on a new token and after sign-in. Unregister when permission is
   turned off.
6. **Prune dead tokens**: on provider feedback, and after 60 days without a refresh.
7. **A notification is a doorbell.** Type, opaque id, fixed localized text. No personal data, ever.
8. **Marketing is opt-in**, separately, and off by default.
9. **The installation id is a random UUID**, not a hardware identifier.
10. **Never log a token** or an installation id.

## The lifecycle

```
tap "Notify me"     → priming → system prompt → granted
token from the OS   → push_sync → PUT /api/devices/{installation_id}   (bound to this session)
new token / weekly  → push_sync → PUT again
permission off      → push_sync → DELETE /api/devices/{installation_id}
sign out            → DELETE (best effort) → the server drops the session's registrations anyway
delete account      → the server drops every registration of the user
provider says dead  → the server drops that registration
```

## Where it lives

| Part                                   | Place                                                             |
| :------------------------------------- | :---------------------------------------------------------------- |
| Registry routes, `DeviceStore`         | `apps/api` (`/api/devices/{installation_id}`)                     |
| `PushSender` seam and payload builders | `apps/api/src/push/`                                              |
| The real APNs and FCM senders          | `apps/api/src/push/{apns,fcm,providers}.rs`, off until configured |
| `push_sync` and `DEVICE_POLICY`        | `crates/rust-core/src/push.rs`, `fixtures/push.json`              |
| Permission entry and priming copy      | the permission catalogue ([PERMISSIONS.md](./PERMISSIONS.md))     |
| The only code that asks for a token    | `Push/SystemPushGateway.swift`, `push/SystemPushGateway.kt`       |
| The notification permission prompt     | `Permissions/SystemPermissionGateway` on each platform            |
| Notification text                      | `eligibility.notification.*` in `locales/`, chosen by the API     |

## Testing without a real token

The debug apps never reach APNs or FCM under a test preset. A screen scenario stages push as available only through a
`permission` given that names `notifications` (iOS `-TranPermission notifications=<status>`; Android
`stagedPermission("notifications=<status>")`): the interpreter then also hands the app a fake push gateway that reports
push available and, once permission is granted, a fixed fake token. Without that given the fake reports push
unavailable, so `notify-me-button` is absent and every other scenario sees the screen it always saw. The API's registry
is tested with `FakeSender` (`apps/api/src/push/sender.rs`); the real senders are tested against a local fake APNs,
Google token endpoint and FCM, with keys the test makes (`apps/api/tests/push_senders_test.rs`). Nothing in the suite
reaches Apple or Google.

## The API's senders

`ApnsSender` posts over HTTP/2 to `api.push.apple.com` (or `api.sandbox.push.apple.com` for a registration from a
development build) with an ES256 provider token it reuses for 50 minutes, inside Apple's 20 to 60 minute window.
`FcmSender` posts to FCM v1 with an access token it gets from Google for the service account and reuses until five
minutes before it expires. Each is on only when all its variables are set ([CREDENTIALS.md](./CREDENTIALS.md)); the
API logs one `push providers` line at start-up with `apns` and `fcm` each `on` or `off`. With a provider off, a send to
its platform answers `not configured` and the registration stays. Half a provider's variables, or a key that does not
parse, stops start-up with a message that names the variable.

To ring one device by hand once a provider is configured, with the same variables in the environment:

```sh
cargo run -p api -- send-test-push --platform ios --token <hex token>            # sandbox by default
cargo run -p api -- send-test-push --platform ios --environment production --token <hex token>
cargo run -p api -- send-test-push --platform android --token <FCM token> --locale ne
```

It sends the `eligibility.reached` doorbell (`--id` sets its opaque id) and exits `0` when the provider accepted it,
`1` with its answer otherwise, `2` for bad arguments or configuration. It addresses a token, not a user: the sample's
registry lives in the running server's memory. Code inside the API rings a user with
`state.push().eligibility_reached(user_id, &id)`, which also removes a registration whose token the provider calls dead.

## The Android token API

firebase-messaging 26 deprecates the registration token (`getToken`, `onNewToken`) in favour of an opt-in
installation-id registration (`register()`, `onRegistered`, behind the `firebase_messaging_installation_id_enabled`
manifest flag). The API's FCM sender addresses `message.token`, the registration token, so the Android gateway stays
on the token, with the deprecation suppressed in `push/SystemPushGateway.kt` only. Moving means changing the sender
and the gateway together.

## What a fork must add

- **Apple:** the Push Notifications capability and an APNs auth key (`.p8`, key id, team id) on the server; build the
  app with `TRAN_PUSH_ENABLED=YES` and the team, which adds the `aps-environment` entitlement (`apps/ios/project.yml`).
- **Google:** a Firebase project; its public values in the Android build; a service account on the server.
- **The credentials for the two real senders** (already implemented and switched off): see
  [CREDENTIALS.md](./CREDENTIALS.md). Then delete the `TODO(credentials)` skips on their live tests
  (`apps/api/tests/push_live_test.rs`) and run them with `cargo test -p api --test push_live_test`.
- **A caller:** the job that decides a person can now vote calls `eligibility_reached`; the sample has no such job.
- **A durable `DeviceStore`** and a scheduled prune.
- **Content fetch:** the route the app calls when a doorbell rings.
- **A marketing opt-in screen** if marketing messages are sent, and a way to turn them off.
