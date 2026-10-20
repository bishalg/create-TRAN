# TRAN Android (Kotlin + Compose)

Platform-native **N** in TRAN: Kotlin + Jetpack Compose, sharing brand tokens and **offline voting rules** with Rust via UniFFI.

## What works today

| Feature                                   | Status                                                                                                                                                                      |
| :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design tokens (`BrandTokens.kt`)          | `pnpm tokens:sync`                                                                                                                                                          |
| Offline vote eligibility (JVM unit tests) | Host `libtran_uniffi.dylib` + JNA; golden `fixtures/vote-eligibility.json`                                                                                                  |
| Offline UI button                         | Calls UniFFI; Gradle `preBuild` stages `libtran_uniffi.so` for `arm64-v8a` + `x86_64`                                                                                       |
| On-device `.so` / emulator JNI            | `scripts/build-rust-lib.sh` (NDK clang linkers — no extra tools beyond the SDK + Rust targets)                                                                              |
| Accessibility instrumentation tests       | `./gradlew connectedDebugAndroidTest` — labels, live region, 48dp targets, 200% font scale, every registry theme, 4.5:1 contrast                                            |
| HTTP API (OkHttp)                         | `TranApiClient` — health + eligibility confirmation; base URL from `tranApiBaseUrl` / `TRAN_API_BASE_URL`, debug-only cleartext, debug-only `X-Debug-Country` (REQ-NAT-011) |

## Layout

```
apps/android/
├── app/src/main/kotlin/com/tran/voting/
│   ├── ui/VotingHomeScreen.kt
│   ├── api/TranApiClient.kt                 # OkHttp: health + eligibility confirmation
│   ├── generated/BrandTokens.kt
│   └── uniffi/…/tran_uniffi.kt              # @generated — pnpm uniffi:generate
├── app/src/debug/                           # Debug-only cleartext config (emulator host + loopback)
├── app/src/androidTest/…/VotingHomeAccessibilityTest.kt
├── app/src/test/                            # Parity + MockWebServer API client tests
├── scripts/build-rust-lib.sh                # cargo + NDK → app/src/main/jniLibs
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

Gradle sets `REPO_ROOT` and `UNIFFI_LIB_DIR` to `../../target/release` so tests load `libtran_uniffi` and read `fixtures/vote-eligibility.json`. The API client tests run here too (MockWebServer); they never open a real socket.

## API client

`pnpm dev:api` serves `http://127.0.0.1:3001`; the emulator reaches the host as `http://10.0.2.2:3001` (the debug default). Override per build:

```bash
cd apps/android
./gradlew assembleDebug -PtranApiBaseUrl=https://api.example.com
# or: TRAN_API_BASE_URL=https://api.example.com ./gradlew assembleDebug
```

Cleartext is allowed only in debug builds for `10.0.2.2`, `localhost` and `127.0.0.1` (`app/src/debug/res/xml/network_security_config.xml`); the release default is `https://` and `X-Debug-Country` is gated by `BuildConfig.DEBUG` (REQ-NAT-011).

## Run on device / emulator

`./gradlew assembleDebug` (or `pnpm android:build`) stages the Rust core first: the `preBuild`
task runs `scripts/build-rust-lib.sh`, which uses the NDK's clang linkers to build
`libtran_uniffi.so` for `arm64-v8a` and `x86_64` into `app/src/main/jniLibs/`. The script adds
the Rust targets itself (`rustup target add aarch64-linux-android x86_64-linux-android`) and
looks for the NDK via `ANDROID_NDK_HOME` / `ANDROID_NDK_LATEST_HOME` / `$ANDROID_HOME/ndk/*`.

## Instrumented accessibility tests

Boot an emulator (or attach a device), then:

```bash
cd apps/android && ./gradlew connectedDebugAndroidTest   # or: pnpm android:test (unit + instrumentation)
```

## Regenerate Kotlin bindings

```bash
pnpm uniffi:generate
```

## Follow-ups

- CI instrumentation run on an emulator (Maestro flows already run locally via `pnpm e2e:maestro`)
- A contract snapshot shared with the web client (REQ-API-011)
