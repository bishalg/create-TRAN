---
name: ios-production
description: >-
  High-quality iOS production engineering standard synthesized from top open-source codebases
  (IceCubesApp, Proton Pass, Element X, Bitwarden, SyncUps, NetNewsWire, Clean Architecture).
  Use this skill whenever writing, reviewing, architecting, refactoring, or testing iOS and SwiftUI code.
---

# iOS Production Engineering Skill

A battle-tested production engineering manual and code template system for modern iOS (Swift 6 & SwiftUI) development. This skill synthesizes architectural patterns, security standards, and foundational utilities from the top 10 open-source iOS applications in the Apple ecosystem:

1. **IceCubesApp (`Dimillian/IceCubesApp`)**: Pure SwiftUI architecture, programmatic navigation routers, and local SPM modularization.
2. **Proton Pass (`protonpass/ios-pass`)**: Enterprise security, biometric Keychain helpers, and strict linting/tooling standards.
3. **Element X (`element-hq/element-x-ios`)**: Unidirectional state machines (`ViewState`/`ViewAction`) and tokenized design systems.
4. **Bitwarden (`bitwarden/ios`)**: Coordinator/Processor flow, zero-dependency async networking, and auto-clearing pasteboards.
5. **SyncUps (`pointfreeco/syncups`)**: Modern `@Observable` architecture with controlled, deterministic dependency injection.
6. **isowords (`pointfreeco/isowords`)**: Hyper-modularized SPM architectures and isolated system service wrappers.
7. **Swiftfin (`jellyfin/Swiftfin`)**: Custom Swift Macros, cross-platform media abstractions, and custom layout containers.
8. **NetNewsWire (`Ranchero-Software/NetNewsWire`)**: Foundational zero-bloat Swift extensions (`RSCore`) and robust file/string operations.
9. **Firefox for iOS (`mozilla-mobile/firefox-ios`)**: Large-scale component kits (`BrowserKit`), dynamic theming, and device privacy detection.
10. **Clean Architecture SwiftUI (`nalexn/clean-architecture-swiftui`)**: Explicit 3-layer Clean Architecture with the canonical `Loadable<T>` async view state.

---

## Quick Reference & Utility Map

When you need a specific pattern, open the matching reference and copy-ready example:

| Engineering Need | Architectural Source | Reference Doc | Copy-Ready Implementation |
| :--- | :--- | :--- | :--- |
| **Async View State Enum (`Loadable<T>`)** | Clean Architecture / IceCubes | [Architecture & Concurrency](./references/architecture_and_concurrency.md) | [Loadable.swift](./examples/Loadable.swift) |
| **Decoupled Navigation & Sheet Routing** | IceCubesApp (`RouterPath`) | [Navigation & Routing](./references/navigation_and_routing.md) | [Router.swift](./examples/Router.swift) |
| **Clean `async/await` URLSession Client** | Bitwarden / IceCubesApp | [Networking Layer](./references/networking_layer.md) | [EndpointNetworkClient.swift](./examples/EndpointNetworkClient.swift) |
| **Biometric & Secure Enclave Keychain** | Proton Pass / Bitwarden | [Security & Keychain](./references/security_and_keychain.md) | [KeychainHelper.swift](./examples/KeychainHelper.swift) |
| **Foundational Extensions (`String`, `Date`, `Array`)** | NetNewsWire (`RSCore`) | [Foundational Utilities](./references/design_system_and_ui.md) | [FoundationExtensions.swift](./examples/FoundationExtensions.swift) |
| **Controlled Test Dependencies** | Point-Free (`SyncUps`) | [Testing & Quality Gates](./references/testing_and_quality_gates.md) | [ControlledDependencies.swift](./examples/ControlledDependencies.swift) |
| **Liquid Glass Design System & Tokens** | create-TRAN / Element X | [Design System & UI](./references/design_system_and_ui.md) | [Brand Tokens & Glass UI](./references/design_system_and_ui.md#liquid-glass-implementation) |

---

## Core Production Principles

Every line of Swift code written or reviewed must adhere to these 8 foundational rules:

### 1. Swift 6 Concurrency & Strict Isolation
- **Rule**: All UI views and ViewModels must be `@MainActor` isolated.
- **Rule**: Never use unstructured `Task { }` inside ViewModels without lifecycle control. Prefer SwiftUI's `.task { }` view modifier, which automatically binds task lifetime to view visibility and handles cooperative cancellation.
- **Rule**: Data passed across concurrency boundaries must conform to `Sendable`. Prefer immutable value types (`struct`, `enum`) over classes.

### 2. Modern Observation (`@Observable`)
- **Rule**: Target iOS 17+ Observation framework (`@Observable`). Avoid legacy `ObservableObject`, `@Published`, and `@StateObject` in new code.
- **Rule**: Keep ViewModels lean. If a state property does not trigger UI invalidation, mark it with `@ObservationIgnored`.

### 3. Asynchronous UI via `Loadable<T>`
- **Rule**: Never store separate `isLoading: Bool`, `data: T?`, and `errorMessage: String?` variables. This causes invalid intermediate states (e.g., `isLoading == true` and `errorMessage != nil`).
- **Rule**: Always model async data using the single source of truth: `Loadable<T>` (`notRequested`, `isLoading(previous: T?)`, `loaded(T)`, `failed(Error)`).

### 4. Decoupled Navigation
- **Rule**: Avoid hardcoded `NavigationLink(destination:)` in child views.
- **Rule**: Use an environment-driven `Router` coordinating a `NavigationPath` with value-type `Hashable` destinations. Present sheets, covers, and alerts via state bindings in the root container.

### 5. Enterprise Security & Privacy
- **Rule**: Never store tokens, passwords, or cryptographic keys in `UserDefaults` or plaintext files. Use the Keychain with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
- **Rule**: When biometric gating is required, enforce `kSecAccessControlBiometryAny`.
- **Rule**: Clear sensitive clipboard data automatically after a timeout (default 60 seconds).
- **Rule**: Protect screens displaying sensitive information from system app switcher snapshots using privacy overlay blurs.

### 6. Value-Type Networking with Interceptors
- **Rule**: Represent network requests as declarative `Endpoint` value types, not monolithic service methods.
- **Rule**: Coordinate authentication token refresh using an `actor` to prevent the "thundering herd" problem when multiple concurrent requests receive HTTP 401.

### 7. Zero Force-Unwraps & Safe Primitives
- **Rule**: Never use `!` (force unwrap) or `try!` in production code.
- **Rule**: Use safe array indexing (`array[safe: index]`) to prevent out-of-bounds runtime crashes.
- **Rule**: Wrap system formatters (`ISO8601DateFormatter`, `NumberFormatter`) in static thread-safe caches to prevent high allocation overhead.

### 8. Test-First Verification & Quality Gates
- **Rule**: Use Swift Testing (`import Testing`, `@Test`, `#expect`) for modern tests, with golden fixtures for cross-platform parity (e.g. UniFFI / Rust).
- **Rule**: Inject side effects (`Date.now`, `UUID()`, `NetworkClient`) via controlled dependencies so previews and unit tests execute deterministically with 100% test coverage.

---

## Standard Development Workflow

When implementing or modifying an iOS feature:

1. **Define the Domain Model & Fixtures**:
   - Create immutable, `Codable`, `Sendable`, `Identified` structs.
   - If sharing business logic with Rust/Kotlin, verify against golden JSON fixtures (`fixtures/*.json`).

2. **Define State & Actions (UDF)**:
   - Formulate the screen's `ViewState` using `Loadable<T>` for async resources.
   - Enumerate explicit user intents in `ViewAction`.

3. **Construct the ViewModel (`@Observable` & `@MainActor`)**:
   - Inject dependencies via default parameters or environment containers.
   - Write the failing unit tests *first* using `testValue` mocks.

4. **Assemble the View (SwiftUI)**:
   - Use tokenized colors and metrics from `BrandTokens`.
   - Apply the Liquid Glass aesthetic (`.ultraThinMaterial`, continuous corners, subtle ambient borders).
   - Ensure minimum touch targets of 44x44pt and add accessibility labels.

5. **Wire Navigation**:
   - Register the view destination in `Router.swift`.
   - Navigate via `router.navigate(to: .detail(id))` without coupling to parent views.

6. **Validate Quality Gates**:
   - Run unit tests: `xcodebuild test` or `pnpm test:rust:coverage` / `pnpm ios:build`.
   - Run SwiftLint / SwiftFormat to ensure zero warnings.
