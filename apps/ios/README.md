# TRAN iOS (SwiftUI)

Platform-native **N** in TRAN: Swift + SwiftUI, sharing brand tokens and **offline voting rules** with Rust via UniFFI.

## What works today

| Feature                             | Status                                                                   |
| :---------------------------------- | :----------------------------------------------------------------------- |
| Design tokens (`BrandTokens.swift`) | `pnpm tokens:sync` from `crates/rust-core/src/tokens.rs`                 |
| Offline vote eligibility            | `evaluateVoteEligibilityOffline` via `crates/tran-uniffi` → `TranEngine` |
| Golden parity tests                 | `Tests/TranVotingDemoTests` reads `fixtures/vote-eligibility.json`       |
| HTTP API client                     | Not wired yet (stretch: URLSession + Axum envelope)                      |

## Layout

```
apps/ios/
├── project.yml              # XcodeGen — source of truth (not Package.swift)
├── TranVotingDemo.xcodeproj # Generated: xcodegen generate
├── scripts/build-tran-uniffi.sh
├── RustLib/                 # Staged libtran_uniffi.a (build script; not all archs committed)
└── Sources/TranVotingDemo/
    ├── VotingHomeView.swift
    ├── Generated/BrandTokens.swift
    └── Generated/UniFFI/    # @generated — pnpm uniffi:generate
```

## Prerequisites

- Xcode 16+ with an iOS simulator
- Rust stable + `rustup target add aarch64-apple-ios-sim` (script adds this automatically)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`

## Regenerate Xcode project

After editing `project.yml`:

```bash
cd apps/ios
xcodegen generate
```

## Build & test

From repo root, build the Rust bridge once (optional — Xcode pre-build also runs this):

```bash
pnpm uniffi:generate   # Swift/Kotlin bindings from release dylib
cd apps/ios && bash scripts/build-tran-uniffi.sh
xcodebuild test -project TranVotingDemo.xcodeproj -scheme TranVotingDemo \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

Open `TranVotingDemo.xcodeproj` in Xcode and Run on a simulator for the demo UI.

## Tokens

Edit `crates/rust-core/src/tokens.rs`, then from the repo root:

```bash
pnpm tokens:sync
```

## Follow-ups

- CI: `xcodebuild test` on macOS runners
- Ship `libtran_uniffi` for device + API screen
- Remove legacy Expo sketch when redundant — see [docs/ROADMAP.md](../../docs/ROADMAP.md)
