# ADR-0039 Sessions are opaque rotating tokens, and each platform keeps them where it can protect them

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [022](../specs/022-security.md)

## Context

The template shows how production code handles rules, errors, loading, accessibility and the supply chain. It showed
nothing about the questions every real app answers on day one: where does a secret go, where does a token live on a
phone and in a browser, what happens when it expires, and what must never be printed. `SECURITY.md` said so itself:
"the sample app has no accounts, no secrets and no personal data". The session was an in-memory role with a
hard-coded user id; `android:allowBackup` was `true`; the CORS list was a literal; the API sent no security headers.

A reader who copies a template copies its omissions. Without a reference, the usual results are a JWT in
`localStorage`, a refresh token in `UserDefaults` or plain `SharedPreferences`, an API key in a `VITE_` variable, and a
client that deletes the session whenever the network blips.

### Threat model

| Threat                                                         | Answer in this template                                                |
| :------------------------------------------------------------- | :--------------------------------------------------------------------- |
| A secret is committed, or shipped inside a client              | Scan in the commit hook and CI; client-visible names are checked (1)   |
| A script injected into the web page steals the session         | Refresh token in an `HttpOnly` cookie, access token in memory, CSP (3) |
| Another site makes the browser use the cookie (CSRF)           | `SameSite=Strict`, cookie scoped to `/api/auth`, `Origin` check (3)    |
| A token is read from a device backup or copied to a new device | Device-only Keychain item; Keystore key; backups excluded (4)          |
| A stolen refresh token is replayed                             | Rotation on every use; a replay revokes the session (2)                |
| A stolen access token                                          | 15-minute lifetime; revoked with its session (2)                       |
| A token leaks through a log, a crash report or a cache         | `Secret` type, allowlisted log fields, `no-store`, leak fixtures (5)   |
| Someone reads the screen from the app switcher                 | Privacy cover on iOS, recents thumbnail disabled on Android (5)        |
| Traffic is read on the network                                 | Already answered: release builds are HTTPS-only (ADR-0023); HSTS added |

Out of scope, on purpose: verifying a credential (the fork's password, passkey or OIDC step), rate limiting and
lockout (nothing to guess while there is no credential), authorisation by role on business routes, certificate
pinning, and a device that is rooted or jailbroken with the attacker present at run time.

## Decision

1. **Secrets are kept out by checks, not by care.** `.env.example` is the contract for configuration and holds no
   credential. A zero-dependency scanner (`pnpm secrets:check`, in the spirit of ADR-0016) runs in the commit hook and
   in CI, checks that the example file and the code agree, and rejects a client-visible setting whose name says it is a
   secret. The rule it teaches: **a client binary has no secrets**. A provider key belongs on the server; the client
   calls the server.

2. **Tokens are opaque and the server remembers them.** An access token (15 minutes) and a refresh token (30 days) are
   32 random bytes each. The server stores their SHA-256 digests behind a `SessionStore` trait; the sample's store is
   in memory, a fork swaps in its database. Refresh rotates the pair, and a refresh token presented twice revokes the
   whole session, because the second presenter may be a thief. The lifetimes are `SESSION_POLICY` in `rust-core`,
   generated like every other rule.

   We did not choose JWTs. A signed token cannot be revoked before it expires without a server-side list, which is the
   store we were avoiding; it adds a signing key to manage and rotate, and a family of well-known verification
   mistakes. For one API with one store, an opaque token costs one lookup and makes sign-out mean what it says. A fork
   with many services that must verify without a shared store has a reason to choose JWT access tokens; the refresh
   half of this design still applies.

3. **The browser never holds the refresh token.** The web app asks for the cookie transport: the refresh token arrives
   as an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`, so page script cannot read it and it is not sent
   with ordinary API calls. The access token lives in a variable and dies with the tab; a reload refreshes. CSRF is
   answered three ways: `SameSite=Strict`, the narrow cookie path, and an `Origin` check on the auth routes. The
   browser still calls the API directly (ADR-0012), which is why CORS becomes configuration with credentials and
   explicit origins (REQ-API-007). The built page declares a CSP so an injected script has nowhere to load from or
   send to.

4. **Phones use the platform's own vault, with no library.** iOS stores one Keychain item, readable after first unlock,
   bound to this device and not synced. Android encrypts the record with an AES-GCM key that never leaves the
   Keystore and writes only ciphertext; `EncryptedSharedPreferences` is deprecated, and the direct code is forty lines.
   Both sit behind a `SessionVault` seam with an in-memory double, so the unit suites stay hermetic (ADR-0023) and the
   real vault is tested once on a device. Native clients use the body transport, because they have somewhere safe to
   put the token. Two platform traps are handled explicitly: a Keychain item outlives the app that wrote it, and an
   Android backup can restore ciphertext whose key is gone.

5. **Sensitive values are typed, and outputs are allowlisted.** Tokens are `Secret` values that print `[redacted]`.
   Logs keep their fixed field list (REQ-ROB-007), so a header can never be logged by default. Auth responses are
   `no-store`. The failure-mode fixture gains rows that send real tokens through failing requests and assert that
   neither the response nor the log repeats them.

6. **The client's reaction to an auth failure is one Rust table.** `session_recovery` says: on `401`, refresh once and
   repeat; if the refresh is _rejected_, sign out; if the refresh merely _failed_, keep the session. It is pinned by
   `fixtures/session.json` on all four languages. Clients share one in-flight refresh, since rotation makes two
   parallel refreshes look like theft.

7. **The device session stays first.** Choosing a role still signs the user in on the device at once and works with no
   network (ADR-0015, ADR-0023). The API session is established behind it and restored from the vault on launch. An
   unreachable API changes the status pill, never the destination. This keeps every existing offline journey and the
   screen contract (ADR-0038) intact, and it is how a real offline-capable app behaves.

## Consequences

- The API is no longer stateless: the in-memory store empties on restart and every client signs in again, which the
  recovery table already handles. A fork that scales past one process must replace the store first.
- The API gains three small dependencies (a hash, an encoder, the OS random source). Clients gain none.
- Clients must single-flight their refresh. The alternative, a server-side grace window for a just-rotated token, was
  rejected because it weakens replay detection to hide a client bug.
- `SameSite=Strict` requires the web app and the API to share a site (`app.example.com` and `api.example.com`). A fork
  on unrelated domains needs a same-site proxy for `/api/auth`, not `SameSite=None`.
- A CSP delivered by `<meta>` cannot say `frame-ancestors`; the host must send that header. The guide says where.
- Certificate pinning is not shipped. It protects against a mis-issued certificate at the cost of an app that stops
  working when a certificate rotates before the app updates; that trade belongs to a fork with an operations plan.
- The debug-only launch presets for a session (ADR-0038) bypass the vault. They are compiled out of release builds, as
  before.
