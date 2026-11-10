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

| Part                                   | Place                                                         |
| :------------------------------------- | :------------------------------------------------------------ |
| Registry routes, `DeviceStore`         | `apps/api` (`/api/devices/{installation_id}`)                 |
| `PushSender` seam and payload builders | `apps/api/src/push/`                                          |
| `push_sync` and `DEVICE_POLICY`        | `crates/rust-core/src/push.rs`, `fixtures/push.json`          |
| Permission entry and priming copy      | the permission catalogue ([PERMISSIONS.md](./PERMISSIONS.md)) |
| The only code that asks for a token    | the push gateway on each platform                             |

## What a fork must add

- **Apple:** the Push Notifications capability and an APNs auth key (`.p8`, key id, team id) on the server.
- **Google:** a Firebase project; its public values in the Android build; a service account on the server.
- **The two real senders** behind `PushSender`: APNs over HTTP/2 with a signed provider token, FCM v1 with OAuth. Map
  each provider's "token is dead" answers to the feedback the trait already handles.
- **A durable `DeviceStore`** and a scheduled prune.
- **Content fetch:** the route the app calls when a doorbell rings.
- **A marketing opt-in screen** if marketing messages are sent, and a way to turn them off.
