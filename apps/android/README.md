# TRAN Android (Kotlin + Compose)

Platform-native **N** in TRAN: Kotlin + Jetpack Compose, sharing brand tokens with Rust via `pnpm tokens:sync`.

## Layout

```
apps/android/
├── app/
│   └── src/main/kotlin/com/tran/voting/
│       ├── MainActivity.kt
│       ├── ui/VotingHomeScreen.kt
│       └── generated/BrandTokens.kt   # @generated — do not edit
├── build.gradle.kts
└── settings.gradle.kts
```

## Tokens

Edit `crates/rust-core/src/tokens.rs`, then from the repo root:

```bash
pnpm tokens:sync
```

## Run (template)

Open the `apps/android` folder in Android Studio and sync Gradle, or use the Gradle wrapper once added.

This scaffold is a **placeholder** screen using shared semantic colors. Add API/offline voting parity with `@tran/core` equivalents via Kotlin or Rust FFI later.

## Legacy Expo client

`apps/native` remains an interim React Native sketch. Prefer this Compose app for production **N**; see [docs/ROADMAP.md](../../docs/ROADMAP.md).
