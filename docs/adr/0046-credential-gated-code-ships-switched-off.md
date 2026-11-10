# ADR-0046 Code that needs real credentials ships complete, switched off and marked

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [019](../specs/019-code-health.md) (REQ-CODE-005)

## Context

Several parts of a real app cannot run without a project's own accounts: uploading to the stores, sending a push
through APNs and FCM, Sign in with Apple and Google, purchases. A template has two bad options. It can leave them out,
and a fork then writes the hardest code alone. Or it can include them untested, and nobody knows what works. ADR-0044
first chose to leave the push senders out for that reason.

## Decision

1. **Write the real thing.** The code that talks to the store or the provider is implemented in full, behind the seam
   the tests already use.
2. **Absence of configuration switches it off.** With no credential set, the feature reports itself unavailable, the
   app and the API build and run, and every test passes.
3. **The tests that need a credential exist and are skipped, with one marker:**
   `TODO(credentials): <VARIABLES> - <what it proves>`. Supplying the variables and deleting the skip is the whole
   enabling step. A fork can list them with one search.
4. **A check keeps the list honest.** `pnpm todos:check` fails on a skipped test without the marker and on a marker
   whose variables are not documented. [`docs/CREDENTIALS.md`](../CREDENTIALS.md) is the one page that says which
   credential unlocks what.
5. **Everything that can be tested without the credential is,** against fakes: request shapes, signatures over a test
   key, error mapping, retries.

This reverses decision 8 of ADR-0044: the APNs and FCM senders are implemented and switched off, not left to a fork.

## Consequences

- The API gains an HTTP client and a signing library for the senders. They are libraries, not product SDKs
  (`AGENTS.md`), and they are compiled in whether or not push is configured.
- A skipped test is a visible promise, not a pass. The check's output and `docs/CREDENTIALS.md` say exactly how many
  there are and why.
- The first run with real credentials may still fail on something the fakes did not model. The skipped tests are
  where that shows up first.
