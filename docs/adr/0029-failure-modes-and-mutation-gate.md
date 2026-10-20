# ADR-0029 Failure modes are a fixture; robustness is measured by mutation, not lines

Status: accepted

## Context

Every layer reached 100% line and branch coverage (ADR-0006) while a review still found failures nobody had written an
example for:

- a birthdate of `1800-01-01` (or the signed year `-262143-01-01`) derived an age the `MAX_AGE` check never saw, and
  `as u16` wrapped the huge one into a plausible `eligible: true`;
- any `TypeError` — including a plain programming bug — was classified as `network.offline`, so a crash showed the
  offline banner and logged at `info`;
- a handler panic dropped the connection with no envelope, no request id and no `error` log;
- serde's rejection text echoed the submitted value into the response and the log;
- `classifyError(Object.create(null))` threw from inside the error handler;
- a caller could not cancel a request, and a slow, older answer could overwrite a newer one.

Line coverage proves a line ran, not that a test would fail if the line were wrong. Example tests prove the cases the
author imagined.

## Decision

1. **Failure modes are data.** `fixtures/failure-modes.json` lists stimuli (an HTTP request to the API, an HTTP answer
   to a client) with the handling every implementation must produce: code, status, retryability, log level, and strings
   that must never appear in a response or log. The Axum API and the TypeScript, Swift and Kotlin clients consume it, the
   same way `vote-eligibility.json` and `feedback.json` pin the rules (ADR-0002, ADR-0028). A new failure mode is one row;
   every platform goes red until it handles it.
2. **Properties over examples where the input space is large.** `proptest` (Rust) and `fast-check` (TypeScript) assert
   invariants for generated input: derived age never exceeds `MAX_AGE` unrejected, country-code validation accepts
   exactly two ASCII letters, retry delays stay inside the jitter window, `classifyError` is total. They run in the
   normal test suites and are PR-blocking.
3. **Error handling is total.** Code that handles an error must not fail: `classifyError` never throws, a panic becomes
   the envelope (`tower-http` `CatchPanicLayer`), the FFI returns `Err` instead of aborting.
4. **One structured event per failure.** Levels mean: `error` a human must act; `warn` a client or dependency misbehaved;
   `info` expected lifecycle (startup, offline); `debug` user input the rules rejected, and every completed request. The
   event is `request failed` with the fixed fields in `fixtures/feedback.json` (`logEvent`). Request payloads never
   reach a log or a developer message. Output is human-readable in `development` and JSON everywhere else; `RUST_LOG`
   still overrides.
5. **Ad-hoc logging fails the build.** Clippy denies `print_stdout`, `print_stderr`, `dbg_macro`, `unwrap_used` and
   `expect_used` outside tests (the codegen CLI may print); ESLint denies `console`; a guard test rejects `console.`,
   `print(`, `NSLog`, `println(` and `android.util.Log` outside each platform's one logger.
6. **Mutation score is the robustness gate.** `cargo-mutants` (Rust core + API) and Stryker (`packages/core-ts`) run
   nightly (`.github/workflows/mutation.yml`), like the native suites (ADR-0021). The first green runs set the baseline;
   it may rise, never fall. They are not PR-blocking until the baseline is stable. Baseline (2026-10-20): cargo-mutants
   149 caught, 0 missed (so any miss fails); Stryker 97.7% (`break` 95; the survivors are equivalent mutants).

## Consequences

- "100% coverage" stays the floor, not the claim. A surviving mutant is a missing test, triaged like a failing one.
- Adding an error code or a failure mode costs one fixture row per platform suite — deliberately.
- Some unreachable-by-construction `expect`s remain; each carries `#[allow(clippy::expect_used, reason = "…")]` that says
  why it cannot fail.
- Not decided here: shipping client logs to a backend (Sentry, OpenTelemetry). The fixed field set makes that a sink
  change, not a call-site change.
