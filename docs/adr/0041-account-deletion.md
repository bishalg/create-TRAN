# ADR-0041 Account deletion is an in-app, server-confirmed action with a public page

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [024](../specs/024-account-deletion.md)

## Context

An app that lets people create an account must let them delete it. Apple rejects apps that do not offer deletion
inside the app (App Store Review Guideline 5.1.1(v)); Google Play requires both an in-app path and a web address where
deletion can be requested without the app. Privacy law (GDPR article 17 and its equivalents) asks for the same thing.
The template had sign-out only, so a fork would meet this requirement for the first time in app review.

The common mistakes are well known: a "delete" button that opens an email draft, deletion that only deactivates,
deletion that clears the phone while the server keeps everything, and other devices that stay signed in.

## Decision

1. **One server route owns deletion.** `DELETE /api/account` erases the caller's data through an `AccountEraser`
   seam and revokes every session of that user. The sample's eraser has only sessions to remove; a fork adds its
   tables there, in one transaction.
2. **The control is in the app, declared in the screen contract**, beside sign-out on every signed-in screen, so
   `pnpm screens:check` fails if a platform loses it.
3. **It is a different action from sign-out**, with its own confirmation in the Rust catalogue and copy that says
   "permanent". Reusing the sign-out dialog would hide the difference that matters.
4. **The server decides, then the device follows.** Sign-out clears the device first because a stale local session is
   harmless (REQ-SEC-022). Deletion is the opposite: the device is cleared only after `204`, and a failed call changes
   nothing, so the user is never told an account is gone when it is not.
5. **A public, static page** explains deletion and links to the web app. Its address is what goes in the Play Console
   and the App Store privacy details.
6. **The audit trail holds no identity.** One log event with the request id records that a deletion happened; logging
   who was deleted would keep the data the user asked us to remove.

## Consequences

- The demo accounts are shared per role, so a deletion signs out everyone using that role. That is honest for a sample
  and is stated in the spec; a fork has real, separate users.
- No re-authentication step is shown, because the sample has no credential to ask for. A fork MUST ask for the
  password, passkey or a fresh identity-provider sign-in before `DELETE /api/account`.
- No grace period or undo. A fork that wants one schedules the erasure and says so on the confirmation and the public
  page.
- A fork using Sign in with Apple must also revoke the Apple tokens on deletion; one using in-app purchases must tell
  the user that deletion does not cancel a store subscription. Both are in the playbook.
- Deletion needs the network. Offline, the action fails with the normal error feedback and can be retried.
