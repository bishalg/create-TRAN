# Legacy Expo / React Native client (interim)

> **Status:** transitional — not the definition of **N** in TRAN.

TRAN **N** means **platform-native mobile**: SwiftUI on iOS (`apps/ios`) and Jetpack Compose on Android (`apps/android`). This folder is a **legacy interim** TypeScript/React Native sketch kept for shared-hook demos and parity with web until native apps reach feature parity.

## When to use

- Quick cross-platform UI experiments in JS
- Comparing `useTranApi` with `apps/web`

## When not to use

- Production iOS/Android apps — use `apps/ios` and `apps/android` instead
- New feature work that should ship on native stores

## Run

```bash
pnpm dev:native   # from repo root
```

Known gaps (assets, entry, SDK skew) are tracked in [docs/ROADMAP.md](../../docs/ROADMAP.md). Plan: migrate voting UI to Swift/Kotlin, then deprecate or remove this app.
