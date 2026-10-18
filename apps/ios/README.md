# TRAN iOS (SwiftUI)

Platform-native **N** in TRAN: Swift + SwiftUI, sharing brand tokens with web and Rust via `pnpm tokens:sync`.

## Layout

```
apps/ios/
├── Package.swift
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

## Run (template)

Open `Package.swift` in Xcode (File → Open) or:

```bash
cd apps/ios
swift build
```

This scaffold is a **placeholder** voting-eligibility screen using shared colors. Wire Rust Core (FFI or API-only) and full offline rules in a follow-up.

## Legacy Expo client

`apps/native` is an interim React Native / Expo sketch. Prefer this SwiftUI app for production **N**; see [docs/ROADMAP.md](../../docs/ROADMAP.md).
