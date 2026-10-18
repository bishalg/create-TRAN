# TRAN Android (Kotlin + Compose)

Platform-native **N** in TRAN: Kotlin + Jetpack Compose, sharing brand tokens and **offline voting rules** with Rust via UniFFI.

## What works today

| Feature | Status |
| :-- | :-- |
| Design tokens (`BrandTokens.kt`) | `pnpm tokens:sync` |
| Offline vote eligibility (JVM unit tests) | Host `libtran_uniffi.dylib` + JNA; golden `fixtures/vote-eligibility.json` |
| Offline UI button | Calls UniFFI when native library is present |
| On-device `.so` / emulator JNI | **Not automated yet** — build Rust for Android ABIs before expecting UI on hardware |
| HTTP API (OkHttp) | Not wired yet |

## Layout

```
apps/android/
├── app/src/main/kotlin/com/tran/voting/
│   ├── ui/VotingHomeScreen.kt
│   ├── generated/BrandTokens.kt
│   └── uniffi/…/tran_uniffi.kt   # @generated — pnpm uniffi:generate
├── app/src/test/…/VoteEligibilityParityTest.kt
├── build.gradle.kts
└── gradlew
```

## Tokens

```bash
pnpm tokens:sync
```

## Unit tests (host JVM)

Build the macOS/Linux host library, then:

```bash
cd apps/android
./gradlew testDebugUnitTest
```

Gradle sets `REPO_ROOT` and `UNIFFI_LIB_DIR` to `../../target/release` so tests load `libtran_uniffi` and read `fixtures/vote-eligibility.json`.

## Run on device / emulator

Open `apps/android` in Android Studio. **Offline Check** requires `libtran_uniffi.so` under `app/src/main/jniLibs/<abi>/` (future: `cargo-ndk` script in ROADMAP).

## Regenerate Kotlin bindings

```bash
pnpm uniffi:generate
```

## Follow-ups

- Gradle pre-build + `cargo-ndk` for `jniLibs`
- CI `./gradlew test` on Ubuntu/macOS
- OkHttp client matching Axum error envelope

Legacy Expo: `apps/native` — see [docs/ROADMAP.md](../../docs/ROADMAP.md).
