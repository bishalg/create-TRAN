# 026 Permissions and privacy prompts

Scope: how the iOS app (`apps/ios`) and the Android app (`apps/android`) ask for a system permission, what they do
when it is refused, which permissions they may declare, how personal questions are asked, and how the template proves
it does not track. The worked example is location: "Use my location" fills the country on the eligibility screen.
Notification permission follows the same rules and is built in the push phase. Builds on
[011](011-error-feedback.md) (presentations), [021](021-screen-contract.md) (declared elements),
[008](008-localization.md) (every string from the dictionaries) and [025](025-mobile-release.md) (privacy manifest).
Rationale: [ADR-0043](../adr/0043-permissions-asked-in-context.md). Playbook: [`../PERMISSIONS.md`](../PERMISSIONS.md).
Store rules: [`../APP_REVIEW.md`](../APP_REVIEW.md).

Vocabulary used below:

- The **system prompt** is the operating system's own permission dialog. An app can show it once (iOS) or a few times
  (Android); after a refusal only the Settings app can change the answer.
- **Priming** is the app's own explanation shown before the system prompt: what the feature does with the permission
  and that it is optional. It has "Continue" and "Not now".
- The **purpose string** is the sentence the system prompt shows (`NS…UsageDescription` on iOS).
- A **personal question** asks for something about the person (gender, birth date, name) rather than about the task.

### REQ-PRV-001 [verified] The permission catalogue is Rust data

`crates/rust-core/src/permissions.rs` MUST define every permission the apps may ask for (`location_approximate`, and
`notifications` from the push phase): its id, the feature it serves, the control whose tap may ask, the locale keys of
its priming title and body, of its purpose string and of its Settings note, the fallback when it is refused, and what
each platform declares for it (`android_permissions`, `ios_usage_descriptions`). It MUST be generated to TypeScript and exported over
UniFFI. A unit test MUST reject a permission whose keys are missing from any locale.
**Verified by:** `permissions.rs` unit tests, `fixtures/permissions.json` on every platform.

### REQ-PRV-002 [verified] What to do next is one Rust decision

`permission_step(status, primed)` MUST be defined once in Rust and pinned by `fixtures/permissions.json`:

| Status                                       | Primed | Step             | Meaning                           |
| :------------------------------------------- | :----- | :--------------- | :-------------------------------- |
| `not_determined`                             | no     | `show_priming`   | Explain first                     |
| `not_determined`                             | yes    | `request_system` | Show the system prompt            |
| `granted` (or `granted_approximate`)         | any    | `use_feature`    | Go on                             |
| `denied` (the system can still ask: Android) | no     | `show_priming`   | Explain again, then ask           |
| `denied` (the system can still ask: Android) | yes    | `request_system` | Ask again after the explanation   |
| `denied_permanently`, `restricted`           | any    | `offer_settings` | Say where to change it; never nag |

Statuses: `not_determined`, `granted`, `granted_approximate`, `denied`, `denied_permanently`, `restricted`. iOS and
Android MUST call it through UniFFI (`permission_step`).
**Verified by:** `crates/rust-core/tests/permission_fixtures.rs`, `crates/tran-uniffi/tests/permission_fixtures.rs`,
`packages/core-ts/tests/permissions.test.ts`, `PermissionParityTests.swift`, `PermissionParityTest.kt`.

### REQ-PRV-003 [verified] A permission is asked only when the person uses its feature

No system prompt may appear at launch, during sign-in or on a screen's first display. The prompt MUST follow a tap on
the control that needs it, and priming MUST come first. "Not now" on priming MUST NOT show the system prompt and MUST
NOT count as a refusal.
**Verified by:** `LocationPermissionTests.swift`, `LocationPermissionTest.kt` (a fake permission gateway records every
request); a source guard that only the permission gateway calls the platform request APIs
(`permission-declarations.test.ts`: `apps/ios/Sources/TranVotingDemo/Permissions/SystemPermissionGateway.swift`,
`apps/android/app/src/main/kotlin/com/tran/voting/permissions/SystemPermissionGateway.kt`).

### REQ-PRV-004 [verified] Refusal leaves a working app

When a permission is refused, restricted or unavailable, the feature MUST fall back as the catalogue says (the country
stays hand-picked), every other feature MUST work unchanged, and nothing may be presented as an error. After a
permanent refusal the control MUST explain once, inline, that the setting can be changed in Settings and offer to open
it.
**Verified by:** the platform permission tests; scenario "Using my location without permission keeps the chosen
country".

### REQ-PRV-005 [verified] Declared permissions and the catalogue agree

Every permission in `AndroidManifest.xml` and every usage-description key in `Info.plist` MUST belong to a catalogue
entry or to an allowlist of non-prompting permissions with a stated reason (`INTERNET`, `ACCESS_NETWORK_STATE`), and
every catalogue entry MUST be declared on the platforms that support it. iOS purpose strings MUST be generated from
the locale dictionaries for every locale, so the system prompt is localized: `pnpm tokens:sync` writes them to
`apps/ios/Sources/TranVotingDemo/Generated/InfoPlist.xcstrings` (`ios_info_plist_strings_path` in
`tooling/design-tokens/codegen.json`), and the `Info.plist` value is the English text.
**Verified by:** `packages/core-ts/tests/permission-declarations.test.ts`.

### REQ-PRV-006 [verified] Location asks for the least it needs

"Use my location" MUST request approximate, while-in-use location only (`ACCESS_COARSE_LOCATION`; reduced accuracy on
iOS), read one fix, turn it into a country code on the device, fill `country-field`, and keep neither the coordinates
nor the fix. Coordinates MUST NOT be sent to the API, logged or stored. No background location permission may be
declared.
**Verified by:** `LocationPermissionTests.swift`, `LocationPermissionTest.kt`, `permission-declarations.test.ts`.

### REQ-PRV-007 [verified] The control is in the screen contract

`use-location-button` MUST be declared on the eligibility screen for iOS and Android, with its priming elements in a
`location_priming` state (`location-priming-continue`, `location-priming-dismiss`) and its Settings note in a
`location_settings_offered` state (`location-settings-note`, `location-open-settings`). The web does not offer it (the
API resolves the country from the request, REQ-API-005); the contract MUST record that as a stated platform exception,
not as a silent gap: each element is `Element::only` iOS and Android, and a scenario runs only on the platforms that
offer every element it names (`scenario_platforms`), so the web's Gherkin never carries it. The refused state is staged
by the `permission` given (`Given the permission "location_approximate" is "denied_permanently"`), which only the
native interpreters implement.
**Verified by:** `pnpm screens:check`; scenarios "Using my location explains first and Not now changes nothing" and
"Using my location without permission keeps the chosen country".

### REQ-PRV-008 [verified] Personal questions are optional and inclusive

A personal question MUST be declared in a Rust catalogue with the feature that needs it, MUST be skippable, and MUST
offer "Prefer not to say". A gender question MUST also offer a self-described answer and MUST NOT be limited to two
choices. A unit test MUST fail when a question is marked required without citing the requirement that makes it
necessary. (The onboarding phase adds the screens that ask them; this requirement fixes the rule first.) The catalogue
is `crates/rust-core/src/personal_questions.rs`: one question today, `gender` (woman, man, non-binary, a self-described
answer, "Prefer not to say"), not required.
**Verified by:** `personal_questions.rs` unit tests, the `personalQuestions` section of `fixtures/permissions.json` in
Rust, UniFFI and TypeScript (`permission_fixtures.rs` in both crates, `permissions.test.ts`).

### REQ-PRV-009 [verified] The template does not track, and a guard proves it

The apps MUST NOT import `AppTrackingTransparency` or `AdSupport`, read an advertising identifier, declare
`NSUserTrackingUsageDescription` or the Android `AD_ID` permission, or declare tracking in the privacy manifest. A
guard MUST fail on any of these, with a message that points to the playbook section a fork follows to add tracking
properly (prompt first, respect the answer).
**Verified by:** `packages/core-ts/tests/no-tracking-guard.test.ts`.
