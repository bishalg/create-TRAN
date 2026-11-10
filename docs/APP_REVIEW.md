# App review checklist

What it is: the store rules a mobile app is most often rejected for, and where this template answers each one. Why it
is here: a rejection arrives after the work is done, so the rule has to shape the code from the start. Each row links
to the spec that makes it testable. Guideline numbers are Apple's App Store Review Guidelines; Google Play has an
equivalent policy for almost every row. The stores revise these texts: read the current wording before a submission.

Status: **done** (built and tested here), **planned** (a phase in [ROADMAP.md](./ROADMAP.md)), **fork** (cannot be
shown without a project's own accounts or content; the row says what to do).

## Accounts and sign-in

| Rule                                                                                     | Guideline | Status  | Where                                        |
| :--------------------------------------------------------------------------------------- | :-------- | :------ | :------------------------------------------- |
| An account can be deleted inside the app, and from a public web page (Play)              | 5.1.1(v)  | done    | [spec 024](./specs/024-account-deletion.md)  |
| Do not force sign-in for features that do not need an account                            | 5.1.1(v)  | done    | The device check works signed out (spec 005) |
| If a third-party sign-in is offered (Google, Facebook), offer Sign in with Apple as well | 4.8       | planned | Sign-in providers phase                      |
| Deleting an account revokes Sign in with Apple tokens                                    | 5.1.1(v)  | planned | Sign-in providers phase                      |
| Reviewers get a working demo account, or a demo mode                                     | 2.1       | done    | Role sign-in needs no credential             |

## Privacy and permissions

| Rule                                                                                            | Guideline  | Status | Where                                              |
| :---------------------------------------------------------------------------------------------- | :--------- | :----- | :------------------------------------------------- |
| Ask for a permission in context, with a purpose string that says why; the app works when denied | 5.1.1(ii)  | done   | [spec 026](./specs/026-permissions-and-privacy.md) |
| Ask only for data the feature needs; personal questions (gender, birth date) are optional       | 5.1.1(iii) | done   | [spec 026](./specs/026-permissions-and-privacy.md) |
| No tracking without the App Tracking Transparency prompt; the template does not track           | 5.1.2(i)   | done   | [spec 026](./specs/026-permissions-and-privacy.md) |
| A privacy manifest declares required-reason APIs and collected data                             | 5.1.1      | done   | [spec 025](./specs/025-mobile-release.md)          |
| A privacy policy link in the app and in the store listing                                       | 5.1.1(i)   | fork   | Add the project's policy URL                       |
| Credentials are stored in the Keychain / Keystore, never in plain storage                       | 5.1.1      | done   | [spec 022](./specs/022-security.md)                |

## Notifications

| Rule                                                                                           | Guideline | Status  | Where      |
| :--------------------------------------------------------------------------------------------- | :-------- | :------ | :--------- |
| Push is optional: the app works without it, and marketing pushes need explicit opt-in          | 4.5.4     | planned | Push phase |
| The device token is registered to the signed-in user, replaced when it changes, and removed on | 4.5.4     | planned | Push phase |
| sign-out and on account deletion, so a signed-out device gets nothing                          |           |         |            |

## Payments

| Rule                                                                          | Guideline | Status  | Where           |
| :---------------------------------------------------------------------------- | :-------- | :------ | :-------------- |
| Digital goods and subscriptions use in-app purchase (StoreKit / Play Billing) | 3.1.1     | planned | Purchases phase |
| A visible "Restore purchases" action                                          | 3.1.1     | planned | Purchases phase |
| Entitlements are verified on the server, not trusted from the device          | 3.1.1     | planned | Purchases phase |
| Subscription terms, price and renewal are shown before purchase               | 3.1.2     | planned | Purchases phase |

## Quality and release

| Rule                                                                               | Guideline | Status | Where                                     |
| :--------------------------------------------------------------------------------- | :-------- | :----- | :---------------------------------------- |
| The app does not crash, has no placeholder content and every control works         | 2.1       | done   | Screen contract, smoke (specs 014, 021)   |
| Accessibility: labels, text scaling, touch targets                                 | (HIG)     | done   | Specs 003, 005, 021                       |
| Export compliance answered in `Info.plist`; Android targets the required API level | 2.3, Play | done   | [spec 025](./specs/025-mobile-release.md) |
| Screenshots and description match what the app does                                | 2.3       | fork   | Store listing                             |

## Rules for a change

- Adding a permission, a sign-in provider, a purchase or a personal question: find its row here first, and add the row
  if it is missing.
- A row moves to **done** only when a spec requirement proves it with a test.
