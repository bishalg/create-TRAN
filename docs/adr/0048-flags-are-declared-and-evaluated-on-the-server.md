# ADR-0048 Flags are declared in Rust, evaluated on the server and cached on the device

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [029](../specs/029-remote-config.md)

## Context

A store release cannot be timed. The iOS and Android builds of one feature are approved on different days, and a
feature that goes wrong in production cannot be pulled back by another release, which takes days. Teams solve this
with a remote-config service (Firebase Remote Config, LaunchDarkly). Those products show the right pattern, and this
template builds that pattern itself rather than importing one (`AGENTS.md`).

The common mistakes: flags read by string literals scattered through the code; no default, so the app misbehaves
offline; a launch screen that waits for the config fetch; flags that are never deleted, until nobody knows which of
two hundred are live; a flag used as the only lock on a paid feature; and rollouts keyed on a user id sent to a
public endpoint.

## Decision

1. **Flags are a Rust catalogue,** generated as typed accessors for each platform. Each flag has a type, a safe
   default, an owner and an expiry date.
2. **The server evaluates.** The app sends its platform, version and bucket; the server answers with plain values.
   Rules change in one place, and an old app needs no knowledge of rule syntax invented after it shipped.
3. **Evaluation is one pure function,** pinned by a fixture, so "who gets this" is testable.
4. **The device never waits.** Compiled defaults, then the last stored answer, then a background fetch with an `ETag`.
   A flag read at launch holds its value for the run, so a screen does not change under the person; a `live` flag,
   meant for kill switches, changes at once.
5. **Ship dark.** The default is the behaviour with no server, so a new feature's default is off. It is switched on
   per platform when that platform's version is live.
6. **Rollouts use a bucket the device derives itself.** The server sees a number from 0 to 99, not an identity.
7. **Flags expire.** A check fails on a flag past its date or read by nobody. A released feature's flag is deleted
   with the dead branch.
8. **Configuration is public and never a lock.** Access is enforced by the API's own routes.
9. **The same response carries the minimum and recommended versions** (ADR-0047), so an app learns it must update at
   launch.
10. **Rules come through a seam.** The sample reads a JSON file that can be replaced without a deploy; a fork points
    the trait at its database or an admin tool.

## Consequences

- The sample has one real flag, `notify_me`, guarding the reminder from spec 027. It demonstrates both uses: it ships
  dark, and it is the kill switch.
- There is no admin screen and no audit trail of who changed a rule; a file under version control is the sample's
  audit trail. A fork that edits rules at run time needs both.
- A change takes up to five minutes to reach an app that is already open, and reaches a closed app at its next
  launch. That is the price of never blocking on the network.
- Evaluating on the server means a rule cannot depend on something only the device knows unless the device sends it.
  Only platform, version and bucket are sent, on purpose.
