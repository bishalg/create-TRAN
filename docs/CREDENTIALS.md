# Credentials and what they unlock

What it is: the one list of everything in this template that needs a project's own accounts, which variables supply
it, and which skipped tests it turns on. Why it is here: the template must pass every test with nothing configured, and
a fork must be able to switch each feature on without reading the code first. Rule:
[ADR-0046](./adr/0046-credential-gated-code-ships-switched-off.md), REQ-CODE-005.

## How to switch something on

1. Set its variables (CI secrets, or your untracked `.env`). They are listed, empty, in `.env.example`.
2. Find its skipped tests: search for `TODO(credentials):` with a variable name from the row.
3. Delete the skip. Run the test. `pnpm todos:check` shows what is still off.

## The list

| Feature                          | Variables                                                                                                                                                 | Spec                                 | State without them                    |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------- | :------------------------------------ |
| iOS upload to TestFlight / store | `TRAN_APPLE_TEAM_ID`, `TRAN_ASC_APP_ID`, `TRAN_ASC_KEY_ID`, `TRAN_ASC_ISSUER_ID`, `TRAN_ASC_KEY_P8`                                                       | [025](./specs/025-mobile-release.md) | `doctor` fails; lanes refuse to start |
| Android upload to Google Play    | `TRAN_ANDROID_KEYSTORE_BASE64`, `TRAN_ANDROID_KEYSTORE_PASSWORD`, `TRAN_ANDROID_KEY_ALIAS`, `TRAN_ANDROID_KEY_PASSWORD`, `TRAN_PLAY_SERVICE_ACCOUNT_JSON` | [025](./specs/025-mobile-release.md) | unsigned release build; lanes refuse  |

Rows for push delivery, sign-in providers and purchases are added by the phases that build them.

## Rules for a change

- A feature that needs an account: implement it fully, switch it off by missing configuration, add its row here.
- A test that needs the account: write it, skip it with `TODO(credentials): <VARIABLES> - <what it proves>`.
- Never make a test pass by faking the credential in CI.
