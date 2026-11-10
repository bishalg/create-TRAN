# API versioning playbook

What it is: the rules that let one API serve several released versions of the web, iOS and Android apps at once. Why
it is here: the server deploys in minutes, each store approves on its own schedule, and people update late, so an API
change that suits today's app can break the one already installed. Rules: [spec 028](./specs/028-api-versioning.md).
Reasons: [ADR-0047](./adr/0047-old-clients-keep-working.md). Switching features on per version:
[REMOTE_CONFIG.md](./REMOTE_CONFIG.md).

## The rules

1. **Add, never change.** New optional request fields, new response fields, new routes. Never remove, rename, retype
   or add a required field inside a version.
2. **A breaking change is a new path** (`/api/v2/…`) next to the old one.
3. **Deploy the server first.** The server must already accept what the new app sends before the app is in a store.
4. **Clients read tolerantly.** Ignore unknown fields; send an unknown enum value to its declared fallback.
5. **Every request says who sent it:** `X-Tran-Client: ios/1.4.0`.
6. **Two thresholds per platform.** Below _recommended_: a prompt that can be dismissed. Below _minimum_: `426` and a
   blocking update screen. Prefer the prompt.
7. **Announce before removing.** `Deprecation` and `Sunset` headers, then watch the logs, then raise the minimum, then
   delete.
8. **The checks decide, not the author.** `pnpm contract:check` and the client replay fail on a break.

## A change, step by step

| You want to                | Do                                                                                  |
| :------------------------- | :---------------------------------------------------------------------------------- |
| Add a field to a response  | Add it. Old apps ignore it.                                                         |
| Add a field to a request   | Make it optional with the old behaviour as the default.                             |
| Add an enum value          | Make sure every client has a fallback for the enum first, and that it has shipped.  |
| Rename or remove a field   | Add the new one, serve both, deprecate the old one, raise the minimum, then remove. |
| Change what a route does   | New route or new API version.                                                       |
| Stop supporting an old app | Raise that platform's recommended version, later its minimum. No release needed.    |

## A release across two stores

```
1. server: deploy the additive change            old and new apps both work
2. apps:   submit iOS and Android                approved on different days
3. config: switch the feature on per platform    once that platform's version is live (REMOTE_CONFIG.md)
4. later:  raise recommended, then minimum       then delete what only old apps needed
```

## Where it lives

| Part                                         | Place                                                                      |
| :------------------------------------------- | :------------------------------------------------------------------------- |
| Base path, client header, version comparison | `crates/rust-core/src/compat.rs`, `fixtures/compat.json`                   |
| Route table, deprecation marker              | `apps/api/src/routes/table.rs`                                             |
| Response snapshots                           | `fixtures/contract/v1/` (`pnpm contract:snapshots`, `pnpm contract:check`) |
| Requests of released clients                 | `fixtures/contract/clients/<platform>/` (`current.json`, `<version>.json`) |
| Minimum and recommended versions             | API configuration (`CLIENT_MIN_VERSION_*`, `CLIENT_RECOMMENDED_VERSION_*`) |
| Update screen and prompt                     | the feedback catalogue and the screen contract                             |
