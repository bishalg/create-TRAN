# Mobile release playbook

What it is: signing, building and delivering the iOS and Android apps with fastlane. Why it is here: it is the part of
a mobile project most often done by hand on one laptop, and the mistakes (a committed keystore, a rebuilt release, a
template's real team id) are expensive. Rules: [spec 025](./specs/025-mobile-release.md). Reasons:
[ADR-0042](./adr/0042-mobile-release-with-fastlane.md).

## The rules

1. **Placeholders in the repo, real values in the environment.** No team id, store id, key, keystore or password has a
   default. They are listed, empty, in `.env.example`.
2. **Never commit signing material.** `.p8`, `.p12`, `.mobileprovision`, `.jks`, `.keystore`, service-account JSON.
   `pnpm secrets:check` fails on them.
3. **Same lanes on both platforms:** `doctor`, `test`, `beta`, `release`.
4. **Lanes do not bump versions.** Use `pnpm release` (ADR-0034); lanes run `pnpm release:check` first.
5. **Build once, promote.** `beta` builds and uploads; `release` promotes that build and never rebuilds.
6. **CI authenticates with keys, not people.** An App Store Connect API key and a Play service account; never an
   Apple ID password.
7. **Delivery is a manual, gated workflow.** It never runs on a pull request and skips without secrets.

## The lanes

| Lane      | iOS (`pnpm ios:lane <lane>`)               | Android (`pnpm android:lane <lane>`) |
| :-------- | :----------------------------------------- | :----------------------------------- |
| `doctor`  | Lists required variables as set or missing | The same                             |
| `test`    | Runs `pnpm ios:test`                       | Runs `pnpm android:test`             |
| `beta`    | Signed `.ipa` → TestFlight                 | Signed `.aab` → Play internal track  |
| `release` | Submits the TestFlight build for review    | Promotes internal → production       |

## The release, end to end

```
pnpm release auto → commit → tag vX.Y.Z → push        version, changelog, GitHub release (spec 017)
Actions → Mobile release → ios / beta                 TestFlight
Actions → Mobile release → android / beta             Play internal track
test the builds
Actions → Mobile release → <platform> / release       the same builds go to review and production
```

## What a fork prepares once

- **Identifiers:** its own bundle id and application id (the scaffolder rewrites `com.tran.voting`), the Apple team
  id, the App Store Connect app id.
- **Apple:** an App Store Connect API key (key id, issuer id, the `.p8` content) with the App Manager role; the app
  record created in App Store Connect.
- **Google:** the app created in the Play Console and enrolled in Play App Signing; an upload keystore; a service
  account with release permission; the first build uploaded by hand (Play requires it before the API works).
- **CI secrets:** every variable under "Mobile release" in `.env.example`. Run `doctor` until nothing is missing.
- **Store forms:** the account-deletion address ([playbook](./ACCOUNT_DELETION.md)), the privacy answers matching the
  privacy manifest, the Play data-safety form.

The first real `beta` run is the fork's acceptance test: this template cannot upload without those accounts.

## When to change the defaults

- Use **`match`** instead of cloud-managed signing when several teams or CI systems must share the same certificates.
- Add **`deliver` / `supply` metadata** when store text and screenshots should come from the repo; the locale
  dictionaries and the screenshot suites are the sources.

## Review checklist for a change

- A new identifier or credential: environment variable, no default, listed in `.env.example`.
- A new lane step: it does not bump a version and does not rebuild in `release`.
- A new required-reason API on iOS (file timestamps, disk space, `UserDefaults`, system boot time): declared in
  `PrivacyInfo.xcprivacy`.
