---
name: android-production
description: >-
  Enterprise-grade Android (Kotlin + Jetpack Compose) production engineering and BDD testing standard.
  Based on Now in Android, Bitwarden Android (SDK 37), Element X Android (Circuit MVI + Konsist),
  Proton Pass Android, and modern BDD testing (Cucumber-Android, Kaspresso, Robot pattern, Maestro).
  Use this skill whenever writing, reviewing, architecting, refactoring, or testing Android Kotlin and Jetpack Compose code.
---

# Android Production Engineering & BDD Skill

A comprehensive production engineering manual and code template system for modern Native Android development (Kotlin, Jetpack Compose, Material 3, Target SDK 37 / Android 17). This skill synthesizes architecture, security, and BDD testing practices from the top open-source Android codebases:

1. **Now in Android (`android/nowinandroid`)**: Google's multi-module Gradle convention plugins (`build-logic`), layered reactive architecture (`UI` -> `Domain` -> `Data`), `StateFlow` UDF, and zero-mock testing doubles.
2. **Bitwarden Android (`bitwarden/android`)**: Target SDK 37 (Android 17), enterprise Android Keystore encryption, Biometrics, Credential Manager API, secure auto-clearing clipboard, and Detekt static analysis.
3. **Element X Android (`element-hq/element-x-android`)**: Slack Circuit MVI (`@Composable fun present(): State`), Konsist architectural linting tests, and `AsyncData<T>` state wrappers.
4. **Proton Pass Android (`protonpass/android-pass`)**: Modular Clean Architecture, Kotlin functional `Result` extensions, and system biometry/crypto services.
5. **Slack Circuit (`slackhq/circuit`) & CatchUp (`ZacSweers/CatchUp`)**: Compose-driven presenter patterns and overlay/sheet coordinators.
6. **BDD Testing Standards**:
   - **Strict Gherkin (`cucumber-android`)**: Direct integration between `.feature` files, Compose `SemanticsNodeInteractionsProvider`, and `@HiltAndroidTest`.
   - **Kotlin BDD DSL (`Kaspresso`)**: Native `step("Given...") { }` DSL with flaky-safety and OS-level `Kautomator`.
   - **Screen/Robot Pattern & Maestro**: Clean separation of test specifications from Compose semantics finders, with declarative `.maestro/flows/*.yaml` for cross-platform E2E smoke tests.

---

## Quick Reference & Utility Map

| Requirement / Utility | Reference Source | Reference Guide | Copy-Ready Implementation |
| :--- | :--- | :--- | :--- |
| **Async State Wrapper (`AsyncData<T>`)** | Element X / Clean Architecture | [Architecture & Circuit](./references/architecture_and_circuit.md) | [AsyncData.kt](./examples/AsyncData.kt) |
| **Circuit MVI Presenter & State** | Slack Circuit / Element X | [Architecture & Circuit](./references/architecture_and_circuit.md) | [CircuitPresenter.kt](./examples/CircuitPresenter.kt) |
| **Hardware Keystore & Biometrics** | Bitwarden / Proton Pass | [Keystore Security & System](./references/keystore_security_and_system.md) | [KeystoreHelper.kt](./examples/KeystoreHelper.kt) |
| **BDD Screen/Robot Test Pattern** | Mozilla Fenix / Proton Pass | [BDD Testing & Maestro](./references/bdd_testing_and_maestro.md) | [ScreenRobot.kt](./examples/ScreenRobot.kt) |
| **Declarative Maestro E2E Flows** | create-TRAN / Element X | [BDD Testing & Maestro](./references/bdd_testing_and_maestro.md#maestro-declarative-flows) | `e2e/maestro/flows/*.yaml` |
| **Konsist Architectural Linting** | Element X Android | [Architecture & Circuit](./references/architecture_and_circuit.md#konsist-architectural-guardrails) | [KonsistArchitectureTest.kt](./examples/KonsistArchitectureTest.kt) |
| **OkHttp Authenticator & Refresh** | Bitwarden Android | [Networking & Result](./references/networking_and_result.md) | [TokenAuthenticator.kt](./examples/TokenAuthenticator.kt) |
| **Gradle Convention Plugins** | Now in Android (`build-logic`) | [Gradle Convention Plugins](./references/gradle_convention_plugins.md) | `build-logic/convention` |

---

## Core Production Principles

Every line of Kotlin and Jetpack Compose code written or reviewed must adhere to these 7 principles:

### 1. Unidirectional Data Flow (UDF) & Immutable State
- **Rule**: UI state must be exposed as a single immutable data class wrapped in Kotlin `StateFlow<ViewState>` (or Circuit `CircuitUiState`).
- **Rule**: Never mutate state variables inside Composables or expose mutable `MutableStateFlow` to Views.
- **Rule**: Asynchronous data must be modeled with `AsyncData<T>` (`Uninitialized`, `Loading(previous)`, `Success(value)`, `Failure(error)`). Never maintain separate boolean flags.

### 2. Modern Compose Architecture: Circuit vs ViewModel
- **Rule**: For feature modules adopting Circuit, define presenters with `@Composable fun present(): State`.
- **Rule**: For standard Android ViewModel screens, follow the `BaseViewModel<State, Action, Event>` pattern from Bitwarden. Collect state with `collectAsStateWithLifecycle()` to prevent background battery drain.

### 3. Enterprise Hardware Keystore (Target SDK 37)
- **Rule**: Sensitive tokens, cryptographic keys, and credentials must be stored using the Android Keystore provider (`AndroidKeyStore`) with AES-256 GCM.
- **Rule**: Mandate hardware-backed user authentication (`setUserAuthenticationRequired(true)`) and biometric integration via AndroidX `BiometricPrompt`.
- **Rule**: In Android 13+ (API 33+) and Android 17 (SDK 37), mark sensitive clipboard items with `ClipDescription.EXTRA_IS_SENSITIVE` and auto-clear after 60 seconds.

### 4. Zero-Mock & Test Doubles Strategy
- **Rule**: Follow Now in Android's testing philosophy: prefer in-memory, fake repository doubles (`TestVotingRepository`) over fragile mocking libraries (`Mockito`/`MockK`). This makes tests resilient to refactoring.
- **Rule**: In BDD tests, write tests using the **Robot Pattern** or **Maestro flows** to decouple test scenarios from volatile UI selectors.

### 5. Architectural Guardrails with Konsist
- **Rule**: Enforce layer boundaries with Konsist tests: UI components must never import database/network layers directly; feature modules must never import `internal` classes from sibling features.
- **Rule**: Ensure every `@Composable` screen has a corresponding `@Preview` annotated test verifying dark and light themes.

### 6. Lean Gradle Modules via Convention Plugins
- **Rule**: Never repeat compiler arguments, Kotlin options, or Compose dependencies across submodules.
- **Rule**: Centralize configurations inside `build-logic/convention` using composite builds (`includeBuild("build-logic")`). Keep individual module `build.gradle.kts` files under 25 lines.

### 7. Thread-Safe Networking with Result Wrappers
- **Rule**: Repository and network calls must return typed `Result<T>` or custom sealed domain models.
- **Rule**: Use an OkHttp `Authenticator` with an `AtomicBoolean` or Mutex to synchronize token refresh and avoid 401 cascading retry storms.
