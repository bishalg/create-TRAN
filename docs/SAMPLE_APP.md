# Sample app walkthrough

End-to-end map of the **Voting Eligibility** template: Rust rules, Axum API, shared tokens, Vite web, platform-native mobile (UniFFI), and the legacy Expo client.

## Architecture (one screen)

```mermaid
flowchart LR
  subgraph clients [Clients]
    Web[apps/web Vite SPA]
    IOS[apps/ios SwiftUI]
    Android[apps/android Compose]
    LegacyRN[apps/native Expo interim]
  end
  subgraph shared [packages]
    CoreTS["@tran/core offline + tokens + client"]
    APIPkg["@tran/api Zod + checkVoteEligibility"]
  end
  subgraph ffi [crates/tran-uniffi]
    Uni[UniFFI exports]
  end
  subgraph backend [apps/api]
    Axum[Axum routes]
  end
  subgraph rust [crates/rust-core]
    Voting[voting.rs]
    Tokens[tokens.rs]
    Engine[TranEngine]
  end

  Web --> CoreTS
  LegacyRN --> CoreTS
  CoreTS --> APIPkg
  Web -->|REST| Axum
  IOS -.->|offline| Uni
  Android -.->|offline| Uni
  Uni --> Engine
  LegacyRN -->|REST| Axum
  Axum --> Engine
  Engine --> Voting
  Tokens -->|pnpm tokens:sync| CoreTS
```

## Offline vs API

| Path                        | Where rules run                                                            | Country source                       |
| :-------------------------- | :------------------------------------------------------------------------- | :----------------------------------- |
| **Offline (web / Expo)**    | `evaluateVoteEligibilityOffline` in `@tran/core` (mirrors `voting.rs`)     | User picks country in the UI         |
| **Offline (iOS / Android)** | `evaluate_vote_eligibility_offline` in `crates/tran-uniffi` → `TranEngine` | User picks country in native UI      |
| **API**                     | `TranEngine::evaluate_vote_eligibility` in Rust                            | Stub geo from IP + `X-Debug-Country` |

Web hook: `apps/web/src/shared/api/useTranApi.ts`  
Legacy native: `apps/native/src/hooks/useTranApi.ts`

Regenerate FFI after changing `tran-uniffi` or exported signatures:

```bash
pnpm uniffi:generate
```

## Change brand colors (design tokens)

1. Edit `crates/rust-core/src/tokens.rs` (`default_design_tokens()`).
2. Run `pnpm tokens:sync`.
3. Regenerated artifacts include:
   - `packages/core-ts/src/generated/*`
   - `apps/web/src/styles/generated/theme.css`
   - `apps/native/src/generated/brandTokens.ts` (legacy RN stub)
   - `apps/ios/.../Generated/BrandTokens.swift`
   - `apps/android/.../generated/BrandTokens.kt`
4. Web uses CSS variables via `theme.css`; React uses `getThemeTokens('light' | 'dark')`; native apps import generated Swift/Kotlin tokens.

See [DESIGN.md](./DESIGN.md).

## Change voting rules (test-first)

1. Add/adjust a case in `fixtures/vote-eligibility.json` — Rust, TS, and UniFFI tests go red.
2. Edit `crates/rust-core/src/voting.rs` (source of truth); `cargo test -p rust-core`.
3. Mirror logic in `packages/core-ts/src/voting.ts`; `pnpm test:ts`.
4. UniFFI re-exports engine paths — run `cargo test -p tran-uniffi` (parity fixtures).
5. API handlers call the engine — no duplicate business logic in Axum.

## API layer

Axum does not run an oRPC server. `@tran/api` defines the contract; handlers return matching JSON. Clients validate with Zod.

Details and curl samples: [API.md](./API.md).

## Local run

```bash
cp .env.example .env
pnpm install
pnpm dev:api    # :3001
pnpm dev:web    # Vite :3000
pnpm dev:native # legacy Expo (apps/native)
# Platform-native N:
pnpm tokens:sync
pnpm uniffi:generate   # after FFI / voting export changes
pnpm ios:build                          # SwiftUI → iOS Simulator build
open apps/ios/TranVotingDemo.xcodeproj  # or run from Xcode
pnpm android:build                      # Compose → debug APK
cd apps/android && ./gradlew installDebug  # install on emulator/device
```

1. Open web — try **Offline** with country `NP` and age `20`, then **API** with `X-Debug-Country` from the country field.
2. Toggle light/dark — eligibility cards use token semantics (`canVote` / `cannotVote`).
3. Status footer shows `GET /api/health` via `TranApiClient.getHealth()`.
4. On iOS/Android — offline eligibility uses UniFFI (same fixture table as Rust core).

See [TESTING.md](./TESTING.md) for the TDD / BDD / E2E / coverage playbook.

## Key files

| Concern           | Location                                                |
| :---------------- | :------------------------------------------------------ |
| Routes            | `apps/api/src/routes/mod.rs`                            |
| Vote handler      | `apps/api/src/routes/vote.rs`                           |
| Geo stub          | `apps/api/src/geo.rs`                                   |
| oRPC/Zod          | `packages/api/src/`                                     |
| Web demo UI       | `apps/web/src/features/eligibility/EligibilityPage.tsx` |
| UniFFI crate      | `crates/tran-uniffi/src/lib.rs`                         |
| iOS demo UI       | `apps/ios/Sources/TranVotingDemo/VotingHomeView.swift`  |
| Android demo UI   | `apps/android/.../ui/VotingHomeScreen.kt`               |
| Legacy RN demo UI | `apps/native/src/screens/HomeScreen.tsx`                |
