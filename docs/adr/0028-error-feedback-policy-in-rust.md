# ADR-0028 The error and feedback policy is a Rust table

Status: accepted

## Context

Each layer improvised: the API returned English prose (and leaked internal messages on 500), the web showed that prose
untranslated, nothing was retried, and "how should the user hear about this?" (inline, toast, banner, dialog, or just a
log line) was decided ad hoc per screen and per platform. That is exactly the kind of decision generated code gets
inconsistently right.

## Decision

`crates/rust-core/src/feedback.rs` is the catalogue: every error code and notable user action maps to an HTTP status,
retryability, log level, one presentation (silent · inline · toast with tone and duration · banner · dialog) and a locale
key. Retry and toast timings are constants there too. `pnpm tokens:sync` generates the table for TypeScript, Swift and
Kotlin; `fixtures/feedback.json` pins all of them (ADR-0002, ADR-0027).

The API envelope stays `{ success, error }` and gains `code`, `retryable` and `request_id`; `error` remains a developer
message, users only ever see the localized message for `code`. Server errors are logged with the request id and answered
generically.

## Consequences

- A new failure is one Rust enum variant + one fixture row + locale strings; the compiler and fixtures flag every
  platform that forgot it.
- Platforms implement the _mechanics_ (a toast view, a dialog, a retry loop) once; the _policy_ is never re-decided.
- Envelope change is additive, so older clients keep working.
