# ADR-0047 Old clients keep working: additive changes, proven by replaying released clients

**Status:** accepted · **Date:** 2026-11-10 · **Spec:** [028](../specs/028-api-versioning.md)

## Context

The API deploys in minutes. An iOS release waits for App Review, an Android release for Play review and a staged
rollout, and people update weeks later or never. So at any moment the API is talking to several versions of each app,
and iOS and Android are rarely on the same one. The template's API was unversioned, clients did not say what version
they were, nothing checked whether a server change would break an app already in people's hands, and there was no way
to retire a version that could no longer be supported. ADR-0034 left "contract tests that detect a breaking change"
as a later step; this is that step.

The failures this causes are familiar: a renamed field crashes last month's app; a new enum value falls through a
`switch`; a server team keeps a dead code path alive for years because nobody knows who still calls it; or, with no
way to force an update, a security fix cannot reach people at all.

## Decision

1. **The server never breaks a supported client.** Within an API version only additive changes are allowed.
2. **A check enforces it, two ways.** Snapshots of real responses are compared with the last release (a removed or
   retyped field fails). And the actual requests each released app makes are kept and replayed against today's
   server. The second catches what a schema comparison cannot: a changed default, a stricter validation.
3. **A breaking change gets a new path** (`/api/v2`) that lives beside the old one. The version is in the path because
   it is visible in every log line and trivial to route.
4. **Every client names itself** in one header. The server can then decide per client, and the logs show which
   versions are still out there, which is what makes removal a decision instead of a guess.
5. **Clients read tolerantly.** They ignore what they do not know and send unknown enum values to a declared fallback,
   so an old app survives a newer server. This is pinned by "responses from the future" in a shared fixture.
6. **A minimum and a recommended version per platform.** Below the minimum the server answers `426` and the app shows
   a blocking update screen; below the recommended it shows a prompt that can be dismissed. They are separate per
   platform because the stores approve on different days. They are configuration, so raising one needs no release.
7. **Deprecation is announced in headers and logs first,** with a sunset date, and removal is blocked by a test while
   any supported client still calls the route.
8. **Health stays unversioned.** Load balancers do not ship through an app store.

## Consequences

- Every product route moves to `/api/v1`. The template has no installed base, so the unversioned paths are removed
  rather than aliased.
- The server carries old shapes for as long as the minimum version needs them. Raising the minimum is how that debt is
  paid, and the replay fixture says exactly what can then be deleted.
- `pnpm release` gains a step: it records the client's requests for the replay. A release without it fails the check.
- The blocking screen is a blunt instrument. The playbook says to use the prompt first and keep the minimum for
  security fixes and versions that truly cannot be served.
- The web normally reloads itself into the newest version; the same rules still apply to a tab left open for days.
