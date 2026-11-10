# Security playbook

How this template handles secrets, sessions and sensitive data, and what a fork must add. The rules are
[spec 022](./specs/022-security.md); the reasons and the threat model are
[ADR-0039](./adr/0039-sessions-tokens-and-secret-storage.md); reporting a vulnerability is in
[`../SECURITY.md`](../SECURITY.md); dependencies are [spec 016](./specs/016-supply-chain.md).

## The five rules

1. **A client binary has no secrets.** Anything in a web bundle, an APK or an IPA can be read by whoever downloads it.
   A provider key lives on the server, and the client calls the server.
2. **A token is stored where the platform can protect it**, and nowhere else (table below).
3. **The access token is short-lived and lives in memory. The refresh token is rotated on every use.**
4. **A rejected refresh signs the user out. A failed refresh does not.** A dead network is not a dead session.
5. **Nothing sensitive is printed**: not to a log, a crash report, a URL, a cache or the app switcher.

## Where each thing lives

| Thing                         | Web                                     | iOS                             | Android                                  | API                          |
| :---------------------------- | :-------------------------------------- | :------------------------------ | :--------------------------------------- | :--------------------------- |
| Public settings (URLs, flags) | `VITE_*` in `.env`                      | build setting → `Info.plist`    | Gradle property → `BuildConfig`          | environment (`.env` locally) |
| Server secrets                | never                                   | never                           | never                                    | environment, typed `Secret`  |
| Access token                  | a variable                              | a property                      | a property                               | SHA-256 digest in the store  |
| Refresh token                 | `HttpOnly` `SameSite=Strict` cookie     | Keychain, this device only      | AES-GCM under a Keystore key             | SHA-256 digest in the store  |
| Preferences (theme, locale)   | `localStorage`                          | `UserDefaults`                  | preferences                              | n/a                          |
| Never use for a credential    | `localStorage`, `sessionStorage`, a URL | `UserDefaults`, a file, a plist | plain preferences, a file, `BuildConfig` | a log line, an error body    |

## `.env`, step by step

- `.env.example` is committed and is the list of every variable the code reads. `.env` is yours and is ignored by git.
- Adding a setting: read it in one place (`apps/api/src/config.rs`, or `import.meta.env` in the web app), add it to
  `.env.example` with a comment and a safe default. `pnpm secrets:check` fails if the two disagree.
- A `VITE_` prefix means "publish this to every visitor". The check rejects a `VITE_` name that looks like a secret.
- In production there is no `.env` file: the host injects the environment (a secret manager, the platform's settings).
  Rotate a secret there, never in git history.
- If a secret is ever committed: revoke it first, then remove it. Rewriting history does not un-leak it.

## The session, end to end

```
sign in      POST /api/auth/session   → access token (15 min) + refresh token (30 days)
call         Authorization: Bearer …  → 200, or 401 auth.session_expired
on 401       POST /api/auth/refresh   → new pair; the old refresh token is dead
             refresh rejected (401)   → clear the vault, ask the user to sign in again
             refresh failed (network) → keep the session, try later
replay       an old refresh token     → the whole session is revoked
sign out     clear the device first, then POST /api/auth/sign-out
```

The lifetimes are `SESSION_POLICY` and the reactions are `session_recovery`, both in
`crates/rust-core/src/session.rs` and pinned by `fixtures/session.json`. Send one refresh at a time: two in parallel
look like a replay.

## What a fork must add

- **A real credential check** in front of `POST /api/auth/session` (password with a slow hash, passkeys, or OIDC with
  PKCE). The sample signs in whoever picks a role.
- **Rate limiting and lockout** on that check.
- **A durable `SessionStore`** (a database or Redis) before running more than one API process.
- **Authorisation**: check the role on each business route, on the server. Hiding a button is not access control.
- **Response headers for the web host**: `Content-Security-Policy` with `frame-ancestors 'none'`,
  `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. The built page carries a CSP
  `<meta>`, which cannot express `frame-ancestors`.
- **The same site for web and API** (`app.example.com`, `api.example.com`), or a same-site proxy for `/api/auth`.
- **A decision on certificate pinning**, with a rotation plan if the answer is yes.
- **Biometric gating** (`kSecAccessControl`, `setUserAuthenticationRequired`) if a stolen unlocked phone is in your
  threat model.

## Review checklist for a change

- Does it read a new environment variable? It is in `.env.example`, and it is not a secret behind `VITE_`.
- Does it store something? It is not a credential, or it goes through the `SessionVault`.
- Does it log, report or put something in a URL? Only the fixed fields; never a header, a token or a body.
- Does it add a route? It is behind the bearer check unless it is meant to be public, and it has the envelope.
- Does it add a dependency or an action? See [spec 016](./specs/016-supply-chain.md).
