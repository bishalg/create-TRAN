# ADR-0015 Core-driven navigation and auth flow

Status: accepted

## Context

Demonstrating real mobile and web application architecture requires illustrating navigation flow, launch bootstrapping, and state-driven routing. Doing this via heavy enterprise databases or third-party auth providers breaks the lightweight, zero-dependency starter template promise of `create-TRAN`.

## Decision

We model navigation destinations (`Splash`, `AuthWelcome`, `VoterDashboard`, `AuditorDashboard`), user roles (`CitizenVoter`, `ElectionAuditor`), and state transitions as pure domain logic shared across `rust-core` and `@tran/core`. Each platform (Web, SwiftUI, Jetpack Compose) natively implements a Launch/Splash screen acting as the central Navigation Director to resolve saved session state and present a two-branch flow without database overhead.

Update (ADR-0027): the destination decision is defined once in `rust-core`. iOS and Android call it through UniFFI
(`resolveDestinationOffline`) and keep only their session storage; TypeScript keeps a tiny director. All are pinned by
`fixtures/navigation.json` (REQ-NAV-006).

## Consequences

Navigation flow is demonstrated cohesively across Web, iOS, and Android using the same mental model as design tokens. The template remains completely runnable in under 5 minutes with zero database setup.
