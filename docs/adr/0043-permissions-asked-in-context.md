# ADR-0043 Permissions are asked in context, from one catalogue, and refusal is a normal state

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [026](../specs/026-permissions-and-privacy.md)

## Context

Permission prompts are where apps most often fail review and lose users. The usual mistakes: every prompt fired at
first launch, before the person knows what the app does; a purpose string that says "we need your location"; a feature
that breaks, or an error dialog, after "Don't Allow"; precise or background location requested for a feature that needs
a country; a permission declared in the manifest and never used; a required gender field with two options; and an
analytics SDK that tracks before any consent. Apple's guidelines 5.1.1 and 5.1.2 and Google Play's user-data policy
reject each of these.

The template had no permission at all, so a fork's first one would be written from memory.

## Decision

1. **One catalogue in Rust.** Each permission names the feature it serves, its priming copy, its purpose string and its
   fallback. The catalogue is checked against the manifest and `Info.plist` in both directions, so an unused
   permission and an undeclared one both fail a test.
2. **One decision function.** `permission_step` maps the platform's status to the next step. The platforms differ
   (iOS asks once; Android can ask again, then stops), so the mapping is exactly the kind of rule that drifts when
   written twice.
3. **Ask in context, after priming.** The system prompt can be shown once, so it is spent only after the person has
   tapped the feature and read why. Declining the priming costs nothing: the system prompt was never shown.
4. **Refusal is a state, not an error.** The feature falls back, the rest of the app is untouched, and the app does not
   ask again. After a permanent refusal it says once where the setting lives.
5. **Least data.** Location is approximate, while in use, one fix, converted to a country on the device and discarded.
   Coordinates never leave the phone.
6. **Platform calls sit behind a gateway.** Only one type per platform touches `CLLocationManager` or the Android
   permission APIs. Tests use a fake, so the flows are tested without system dialogs, which UI tests cannot drive
   reliably.
7. **Personal questions are data too.** Optional by default, with "Prefer not to say", and an inclusive gender
   question. Making one required needs a cited reason.
8. **No tracking, enforced.** The template shows no App Tracking Transparency prompt because it has nothing to ask
   about. A guard fails when tracking code appears, and the playbook says how a fork adds it correctly.

Location is the worked example because the app already has a country field it can fill. Notifications use the same
catalogue and function in the push phase.

## Consequences

- The web has no location control: the API already resolves the country from the request. The screen contract records
  the exception explicitly.
- The real system prompt and the real location fix are exercised by hand on a device, not in CI. Everything around
  them is tested through the gateway.
- Reverse geocoding on the device needs the platform geocoder, which may use the network; without it the feature
  falls back like a refusal.
- Adding a permission is now four steps (catalogue, strings, declaration, gateway call), and the tests name the one
  that is missing.
