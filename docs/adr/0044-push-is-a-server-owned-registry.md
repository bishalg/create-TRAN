# ADR-0044 Push is a server-owned device registry, and a notification is a doorbell

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [027](../specs/027-push-and-devices.md)

## Context

Push looks like one call ("send the token to the server") and is where apps most often leak one person's information
to another. The usual failures: the token stays registered after sign-out, so the next person to use the phone, or the
previous owner of a sold one, gets the old account's notifications; a reinstall leaves two registrations and every
message arrives twice; tokens the provider has retired are sent to forever; the notification text contains personal
data that shows on a lock screen; the permission prompt fires at first launch; and marketing messages go to people who
only agreed to reminders. Stores reject the last two (Apple 4.5.4), and the first is a privacy incident.

## Decision

1. **The server owns the registry's correctness.** A registration is bound to the session it was made in. Revoking the
   session removes it, in the same operation: sign-out, a replayed refresh token and account deletion all end
   delivery without the device having to say anything. The client's own unregister call is a courtesy.
2. **One token, one user.** Registering a token removes any earlier registration of it. The newest claim wins, because
   the device is in that person's hands now.
3. **The installation id is random and local.** It only distinguishes installs. It is not a hardware identifier, so it
   is not tracking data and it resets on reinstall.
4. **Dead tokens are removed, two ways:** when the provider says so, and when a registration has not been refreshed
   for 60 days. Clients re-register weekly so a live device is never pruned.
5. **The client's token logic is one Rust table** (`push_sync`), run at launch, on foreground, on a new token and after
   sign-in. It also unregisters when the person turns notifications off in Settings.
6. **A notification is a doorbell.** The payload holds a type, an opaque id and localized fixed text. The app fetches
   the content with its session. Nothing personal can appear on a lock screen or in a provider's logs.
7. **Permission is asked in context** (ADR-0043): "Notify me when I can vote" appears with a "not yet eligible"
   verdict. Marketing is a separate, off-by-default flag on the registration.
8. **Sending is real code, switched off.** The API has a `PushSender` trait, the payload builders and the handling of
   provider feedback, tested with a fake sender. The two real senders (APNs over HTTP/2 with a `.p8` key; FCM v1 with
   a service account) are implemented behind the trait and enabled only by their configuration; their live tests are
   skipped with a `TODO(credentials)` marker (ADR-0046).
9. **Android uses FCM, the platform's push service, through its own library.** This is the one exception to "no
   third-party product SDKs": Android has no other supported way to receive a push. The library is initialised from
   build values, with no `google-services.json` in the repo, and the app builds and runs without them.

## Consequences

- With nothing configured, push is unavailable and the control is hidden. Every flow is still tested through the
  gateway fakes; a real token and a real delivery need a project's APNs key and Firebase project, and the tests for
  them are present and skipped ([CREDENTIALS.md](../CREDENTIALS.md)).
- The registry is in memory, like the session store, until the persistence phase.
- The web has no push. Web Push is a different protocol with its own permission model; a fork that wants it adds a
  third platform value and a service worker.
- The FCM values in a build are public identifiers, not secrets, although one is named "API key". The client-name
  check gets an explicit, commented allowance for it.
- Sign-out makes one more network call, which may fail. That is acceptable because the server side does not depend on
  it.
