# Account deletion playbook

What it is: a person removes their account and its data for good. Why it is here: the App Store (guideline 5.1.1(v))
and Google Play reject apps with accounts and no deletion, and privacy law requires it. Rules:
[spec 024](./specs/024-account-deletion.md). Reasons: [ADR-0041](./adr/0041-account-deletion.md).

## The rules

1. **In the app.** A visible "Delete account" control on signed-in screens. Never an email link or a support form.
2. **On the web too.** A public page explains deletion and leads to it without the app installed.
3. **Ask first, and say "permanent".** Its own confirmation; never the sign-out dialog.
4. **Really delete.** The server erases the data and revokes every session on every device. Deactivating is not
   deleting.
5. **Server first, device second.** Clear the vault only after the server answers `204`. On failure, change nothing
   and show the error.
6. **Leave no identity behind.** The log says a deletion happened, not whose.

## The flow

```
tap "Delete account" → confirmation dialog → DELETE /api/account (bearer)
  204      → clear vault and token → Auth Welcome → success toast
  failure  → keep everything → normal error feedback
  401      → the usual refresh-and-repeat (spec 022)
```

## Where it lives

| Part                   | Place                                                                                        |
| :--------------------- | :------------------------------------------------------------------------------------------- |
| Route and erasure seam | `apps/api/src/routes/account.rs`, `AccountEraser` in `apps/api/src/account.rs`               |
| Confirmation and copy  | `crates/rust-core/src/feedback.rs` (`UserAction::DeleteAccount`, `AccountDeleted`)           |
| Control and scenarios  | `crates/rust-core/src/screens/` (`delete-account-button`, `delete-account-confirm`)          |
| Public page            | `apps/web/account-deletion.html`, filled from `locales/` by `apps/web/src/account-deletion/` |

## What a fork must add

- **Re-authentication** just before deletion (password, passkey or a fresh provider sign-in).
- **Its own data** in the `AccountEraser`: every table, file and third-party record, in one transaction or one job.
- **Sign in with Apple:** revoke the user's Apple tokens when the account is deleted.
- **Subscriptions:** say that deleting the account does not cancel a store subscription, and link to where it can be.
- **Retention:** if the law requires keeping something (invoices), state what and for how long, on the confirmation
  and the public page.
- **Store forms:** put the public page's address in the Play Console "Data deletion" form and in App Store Connect.
