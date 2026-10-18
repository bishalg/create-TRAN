# 006 Navigation & Auth Flow

Scope: Central navigation director, launch/splash bootstrap, and role-based branching across Web (`apps/web`), iOS (`apps/ios`), and Android (`apps/android`).
Rationale: [ADR-0015](../adr/0015-core-driven-navigation-and-auth-flow.md).

### REQ-NAV-001 [verified] Central Navigation Director boots to Splash screen

The app MUST initialize in a bootstrap state where the Navigation Director inspects session persistence before deciding the active navigation stack.
**Verified by:** unit test `navigation.test.ts` / BDD `@REQ-NAV-001`.

### REQ-NAV-002 [verified] Unauthenticated session presents two branching options

When no valid session exists, the Navigation Director MUST route to the Auth Welcome screen offering two distinct branching options: Citizen Voter and Election Auditor.
**Verified by:** unit test `navigation.test.ts` / BDD `@REQ-NAV-002`.

### REQ-NAV-003 [verified] Citizen Voter branch routes to Voting Dashboard

Selecting the Citizen Voter role MUST transition the navigation stack to the Voting Eligibility Dashboard.
**Verified by:** unit test `App.test.tsx` / BDD `@REQ-NAV-003`.

### REQ-NAV-004 [verified] Election Auditor branch routes to Auditor Dashboard

Selecting the Election Auditor role MUST transition the navigation stack to the Election Auditor Rule Matrix Dashboard.
**Verified by:** unit test `App.test.tsx` / BDD `@REQ-NAV-004`.

### REQ-NAV-005 [verified] Sign out returns to Auth Welcome

Invoking Sign Out from either dashboard branch MUST clear the active session and reset the navigation stack to the Auth Welcome screen.
**Verified by:** unit test `App.test.tsx` / BDD `@REQ-NAV-005`.
