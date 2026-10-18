# TRAN iOS (SwiftUI)

Platform-native **N** in TRAN: Swift + SwiftUI, sharing brand tokens with web and Rust via `pnpm tokens:sync`.

## Layout

```
apps/ios/
├── project.yml                     # XcodeGen spec — source of truth
├── TranVotingDemo.xcodeproj        # generated (committed) via `pnpm ios:project`
└── Sources/TranVotingDemo/
    ├── TranVotingDemoApp.swift
    ├── VotingHomeView.swift
    └── Generated/BrandTokens.swift   # @generated — do not edit
```

## Tokens

Edit `crates/rust-core/src/tokens.rs`, then from the repo root:

```bash
pnpm tokens:sync
```

`BrandTokens.swift` is regenerated under `Sources/TranVotingDemo/Generated/`.

## Run

Open `TranVotingDemo.xcodeproj` in Xcode and run on an iOS 17+ simulator, or from the repo root:

```bash
pnpm ios:build   # xcodebuild for iOS Simulator, no signing
```

Regenerate the project after editing `project.yml`:

```bash
pnpm ios:project   # requires XcodeGen: brew install xcodegen
```

The generated project is committed, so opening and running works without XcodeGen installed.

This scaffold is a **placeholder** voting-eligibility screen using shared colors. Wire Rust Core (FFI or API-only) and full offline rules in a follow-up.

## Legacy Expo client

`apps/native` is an interim React Native / Expo sketch. Prefer this SwiftUI app for production **N**; see [docs/ROADMAP.md](../../docs/ROADMAP.md).
