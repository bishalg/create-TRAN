# ADR-0036 Crashes, authentication, toast pressure and recovery are policy too

Status: accepted

## Context

ADR-0028 put every request failure in one Rust table. Four kinds of failure were still decided ad hoc or not at all:

- **Crashes.** A render error on the web left a blank page; uncaught errors and rejections were never classified, and
  native crashes were not reported anywhere.
- **Authentication and permission.** `401`, `403` and `409` fell into `request.malformed`, so an expired session read
  "the request could not be read".
- **Toast pressure.** A failure repeated in a loop stacked identical toasts without limit.
- **Recovery.** The offline banner only cleared when the user happened to retry; nothing noticed the network coming
  back. And nothing distinguished "log this" from "a human must look at this".

## Decision

Extend the catalogue in `crates/rust-core/src/feedback.rs`:

- Codes `auth.session_expired` (401, dialog), `auth.forbidden` (403, toast), `request.conflict` (409, toast) and
  `client.render_failed` with a new presentation, `screen`: the last resort when the view tree itself is broken.
- `TOAST_POLICY` (max visible, de-duplication) with one admission function, `admit_toast`, exported over UniFFI and
  mirrored in TypeScript.
- `RECOVERY_POLICY` and `recovery_probe_delay_ms`: while a banner is up, probe health on a doubling schedule and at once
  on reconnect or foreground.
- The `error` log level now means "report it": every platform sends those events, and only those, to one pluggable
  reporter with the fixed `logEvent` fields.

All of it is pinned by new sections of `fixtures/feedback.json`, so Rust, TypeScript, Swift and Kotlin agree.

The presentations, in rising order of interruption, are: `silent` < `inline` < `toast` < `banner` < `dialog` <
`screen`. Choose the lowest one that lets the user act.

## Consequences

- A new failure is still one variant plus one fixture row; the toast queue and the probe schedule cannot drift because
  they are fixture rows too.
- Native apps cannot recover a broken view tree; they report and let the process end. The `screen` presentation is
  therefore web-only, and the spec says so rather than pretending otherwise.
- The reporter is a seam, not a vendor: the template ships none, so it adds no dependency and sends no data.
