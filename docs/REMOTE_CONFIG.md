# Feature flags and remote configuration playbook

What it is: the server telling each app version what is switched on. Why it is here: store releases cannot be timed
and cannot be recalled, so a feature must be able to ship turned off, be turned on per platform when that platform's
version is live, and be turned off in minutes if it breaks. Rules: [spec 029](./specs/029-remote-config.md). Reasons:
[ADR-0048](./adr/0048-flags-are-declared-and-evaluated-on-the-server.md). Versions living side by side:
[API_VERSIONING.md](./API_VERSIONING.md).

## The rules

1. **Declare the flag in Rust** with a type, a safe default, an owner and an expiry date. Read it only through the
   generated accessor.
2. **The default is what happens with no server.** New feature: default off.
3. **Never wait for config.** Defaults, then the stored answer, then a background fetch. No spinner, no error.
4. **Stable within a run,** unless the flag is `live` (kill switches).
5. **The server evaluates;** the app sends platform, version and a bucket, never an identity.
6. **A flag is not a lock.** The API still enforces who may do what.
7. **No secrets or personal data in config.** It is a public route.
8. **Delete the flag when the feature is fully out,** with the branch it guarded. `pnpm flags:check` fails on stale
   ones.

## Shipping a feature across two stores

```
1. declare the flag, default off; build the feature behind it
2. deploy the server; release iOS and Android (approved on different days)
3. rule: on for ios >= 1.5.0          when the iOS version is live
4. rule: on for android >= 1.5.0      when the Android version is live
5. something breaks → set it off      apps hide the feature on their next fetch
6. fully released → delete the flag and the off-branch
```

## A rule file

```json
{
  "flags": {
    "notify_me": [
      { "platform": "ios", "min_version": "1.5.0", "rollout": 100, "value": true },
      { "platform": "android", "min_version": "1.5.0", "rollout": 25, "value": true }
    ]
  }
}
```

The first matching rule wins; no match gives the default. Raising `rollout` only adds people.

## Where it lives

| Part                             | Place                                                   |
| :------------------------------- | :------------------------------------------------------ |
| Flag catalogue and `evaluate`    | `crates/rust-core/src/flags.rs`, `fixtures/flags.json`  |
| Route and `ConfigSource`         | `apps/api` (`GET /api/v1/config`, `REMOTE_CONFIG_PATH`) |
| Fetch, cache and typed accessors | the remote-config client on each platform               |
| Stale-flag check                 | `pnpm flags:check`                                      |

## What a fork adds

- A `ConfigSource` backed by its database, with an admin screen and an audit trail of changes.
- More rule conditions if it needs them (country, account tier), each sent by the device on purpose.
- Experiments: a flag with several string values and an analytics event, kept behind the same seams.
