# Permissions and privacy playbook

What it is: how the apps ask for a system permission, ask a personal question, and stay out of tracking. Why it is
here: these are the most common reasons for a store rejection (Apple 5.1.1, 5.1.2; Google Play user data) and for
people uninstalling an app. Rules: [spec 026](./specs/026-permissions-and-privacy.md). Reasons:
[ADR-0043](./adr/0043-permissions-asked-in-context.md). All store rules: [APP_REVIEW.md](./APP_REVIEW.md).

## The rules

1. **Never at launch.** Ask when the person taps the feature that needs it.
2. **Prime first.** The app explains what it will do and that it is optional; only "Continue" shows the system prompt.
3. **Say why, specifically.** "Finds your country to pick the right voting age", not "needs your location".
4. **Refusal is fine.** The feature falls back, nothing else changes, no error is shown, and the app does not ask
   again. After a permanent refusal, say once where the setting is.
5. **Ask for the least.** Approximate before precise, while-in-use before always, one reading before a stream.
6. **Declare only what is used.** Every manifest permission and usage string has a catalogue entry, and the reverse.
7. **Personal questions are optional**, with "Prefer not to say"; gender is never two choices.
8. **No tracking.** No advertising identifier, no tracking SDK, no App Tracking Transparency prompt to show.

## The flow

```
tap the feature → permission_step(status, primed)
  show_priming    → "Continue" → request_system        "Not now" → nothing happened
  request_system  → granted → use_feature              refused → fallback, no error
  use_feature     → do the work, keep nothing extra
  offer_settings  → one inline note with "Open Settings"
```

## Where it lives

| Part                             | Place                                                                                 |
| :------------------------------- | :------------------------------------------------------------------------------------ |
| Catalogue and `permission_step`  | `crates/rust-core/src/permissions.rs`, `fixtures/permissions.json`                    |
| Priming copy and purpose strings | `locales/` (generated to `Generated/InfoPlist.xcstrings` and Android resources)       |
| The only code that asks the OS   | `Permissions/SystemPermissionGateway.swift`, `permissions/SystemPermissionGateway.kt` |
| Personal-question catalogue      | `crates/rust-core/src/personal_questions.rs`                                          |
| Guards                           | `permission-declarations.test.ts`, `no-tracking-guard.test.ts`                        |

## Adding a permission

1. Add it to the Rust catalogue with its feature, copy keys and fallback.
2. Add the strings in every locale; run `pnpm tokens:sync`.
3. Declare it in `AndroidManifest.xml` and `apps/ios/project.yml`.
4. Call it through the gateway from the control that needs it. Add its row to [APP_REVIEW.md](./APP_REVIEW.md).

## If a fork needs tracking

Tracking means linking this app's data with data from other companies' apps or sites for advertising, or sharing it
with a data broker. If a fork does that: add `NSUserTrackingUsageDescription`, show the App Tracking Transparency
prompt before any tracking code runs, treat a refusal as final, declare the tracking domains in the privacy manifest,
declare the `AD_ID` permission on Android, and update the store privacy answers. Then change the guard, in the same
change, to check for the prompt rather than for the absence of tracking.
