# ADR-0023 Native API clients

Status: accepted

## Context

The web app has always called the Axum API directly (ADR-0012) with a thin `TranApiClient` and shows
a status pill plus an offline notice when the server cannot be reached. The native apps were
deliberately offline-only (`REQ-NAT-002`: "neither app contains networking code") and the README
listed URLSession / OkHttp as a stretch. That left three gaps:

- The native verdict and the server verdict could silently diverge — the sample never compared them.
- A reader copying the template had no reference for the platform-specific networking gotchas:
  Android's emulator host is `10.0.2.2` and cleartext HTTP is blocked on API 28+, while iOS App
  Transport Security blocks loopback HTTP unless exempted.
- The web's offline notice vocabulary (`shell.status.*`, `eligibility.offlineNotice`) had no native
  consumer, so a network failure was indistinguishable from a rule change.

## Decision

1. **Thin clients, device-first verdict.** iOS `Sources/TranVotingDemo/Api/TranApiClient.swift` and
   Android `api/TranApiClient.kt` expose `checkHealth()` (`GET /api/health`) and
   `confirmEligibility(age:)` (`POST /api/vote/eligibility`). The response body is intentionally not
   parsed on native: the device verdict is the product (REQ-NAT-002), and the call only confirms the
   API agrees the client can reach it. The rich contract client stays the web one.
2. **Configurable base URL per build.** iOS resolves `TranApiBaseUrl` from `UserDefaults` (launch
   argument — used by the UI tests) then the Info.plist value generated from the `TRAN_API_BASE_URL`
   build setting; Android reads `tranApiBaseUrl` / `TRAN_API_BASE_URL` into `BuildConfig`. Defaults are
   the emulator-friendly `http://10.0.2.2:3001` (Android debug) and `http://127.0.0.1:3001` (iOS);
   the release default is `https://` so a shipped build never points at cleartext.
3. **Cleartext is debug-only.** Android adds a debug-only `networkSecurityConfig` scoped to
   `10.0.2.2`, `localhost` and `127.0.0.1` (main manifest carries only the `INTERNET` permission);
   iOS uses `NSAllowsLocalNetworking` — never `NSAllowsArbitraryLoads`. `native-networking.test.ts`
   guards both, including the generated Info.plist.
4. **`X-Debug-Country` is debug-only.** The clients take an `includeDebugCountry` flag that is
   `#if DEBUG` / `BuildConfig.DEBUG` at the call site; release builds let the server resolve geo from
   the request. The header is the web's dev affordance (`REQ-API-006` still tracks server-side
   gating).
5. **Network failures are a status, not an error path.** The verdict is computed and shown before the
   API call, which never blocks or replaces it. A network failure only flips the status pill
   (`shell.status.checking/online/offline`, mirroring the web footer) and reveals
   `eligibility.offlineNotice`; an HTTP rejection means the server answered, so it is not "offline"
   (same semantics as web's `isNetworkError`).
6. **Tests stub the transport, never a live API.** iOS unit tests run a stubbed `URLSession`
   (`URLProtocol`), Android unit tests run `MockWebServer`; the UI/instrumentation journeys point the
   client at an unreachable port to pin the offline behaviour deterministically.

## Consequences

- Native suites stay hermetic: no test needs `pnpm dev:api`, so CI and `pnpm ios:test` /
  `pnpm android:test` remain reproducible.
- `pnpm android:test` now runs the JVM unit tests before the instrumentation tests — the first
  native-client tests that do not need an emulator.
- The clients duplicate the web's endpoint paths and status vocabulary by hand; a contract change
  (`REQ-API-011` snapshots) must touch three clients, and the native ones fail loudly only at runtime.
- Debug-only cleartext means a release build must target an `https://` API; the placeholder
  `https://api.tran.example` documents where that setting goes.
