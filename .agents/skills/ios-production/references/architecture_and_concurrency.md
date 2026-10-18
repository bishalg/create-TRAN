# Architecture & Concurrency Guide

This guide establishes the architectural blueprint for modern iOS applications targeting Swift 6, iOS 17+, and the Observation framework, drawing on proven patterns from **IceCubesApp**, **Element X**, **Bitwarden**, and **SyncUps**.

---

## 1. Swift 6 Concurrency & Actor Isolation

### The `@MainActor` Standard

SwiftUI view bodies and UI-bound view models must be strictly isolated to the main actor to guarantee that state mutations and rendering occur deterministically on the main thread without race conditions.

```swift
import SwiftUI
import Observation

// Always annotate ViewModels with @MainActor
@Observable
@MainActor
public final class AccountViewModel {
    public private(set) var state: Loadable<Account> = .notRequested
    private let client: APIClientProtocol

    public init(client: APIClientProtocol = APIClient.live) {
        self.client = client
    }

    public func fetchAccount(id: String) async {
        state = .isLoading(previous: state.value)
        do {
            let account = try await client.fetchAccount(id: id)
            state = .loaded(account)
        } catch {
            state = .failed(error)
        }
    }
}
```

### Background Computation with Non-Isolated Actors

Heavy parsing, cryptography, or database queries must run on background actors and transfer results across isolation domains using `Sendable` types:

```swift
public actor BackgroundWorker {
    public init() {}

    public func processLargePayload(_ data: Data) throws -> ProcessedResult {
        // Runs off the main actor without blocking the UI runloop
        let decoded = try JSONDecoder().decode(LargePayload.self, from: data)
        return decoded.computeSummary()
    }
}
```

### Task Lifecycle & Cooperative Cancellation

Never launch detached, fire-and-forget tasks in view models without managing cancellation. In SwiftUI, use `.task` view modifiers that bind task lifecycles directly to the view hierarchy:

```swift
struct AccountView: View {
    @State private var viewModel = AccountViewModel()
    let accountId: String

    var body: some View {
        Group {
            switch viewModel.state {
            case .notRequested, .isLoading(nil):
                ProgressView("Loading account…")
            case .isLoading(let previous?):
                AccountContentView(account: previous)
                    .overlay(alignment: .top) { ProgressView() }
            case .loaded(let account):
                AccountContentView(account: account)
            case .failed(let error):
                ErrorStateView(error: error) {
                    Task { await viewModel.fetchAccount(id: accountId) }
                }
            }
        }
        // Automatically started when the view appears, cancelled when it disappears
        .task(id: accountId) {
            await viewModel.fetchAccount(id: accountId)
        }
    }
}
```

---

## 2. Unidirectional Data Flow (UDF)

Inspired by **Element X** and **Bitwarden**, complex screens should model user interactions through explicit state machines.

```
+-------------+         ViewAction         +-------------------+
|             | -------------------------> |                   |
|   SwiftUI   |                            |     ViewModel     |
|    View     | <------------------------- |   (Processor)     |
|             |          ViewState         |                   |
+-------------+   (Single Source of Truth) +-------------------+
```

### Protocol & State Machine Pattern

```swift
// 1. Immutable State
public struct VotingViewState: Equatable, Sendable {
    public var ageText: String = "21"
    public var countryCode: String = "NP"
    public var eligibility: Loadable<VoteEligibilityResult> = .notRequested
    public var isSubmitting: Bool = false
}

// 2. Explicit User & Lifecycle Actions
public enum VotingViewAction: Sendable {
    case ageChanged(String)
    case countryChanged(String)
    case submitTapped
    case retryTapped
}

// 3. Processor / ViewModel
@Observable
@MainActor
public final class VotingViewModel {
    public private(set) var state: VotingViewState
    private let engine: VotingEngineProtocol

    public init(
        initialState: VotingViewState = VotingViewState(),
        engine: VotingEngineProtocol = LocalVotingEngine()
    ) {
        self.state = initialState
        self.engine = engine
    }

    public func send(_ action: VotingViewAction) {
        switch action {
        case .ageChanged(let newAge):
            state.ageText = newAge.filter(\.isNumber)
        case .countryChanged(let newCountry):
            state.countryCode = newCountry.uppercased()
        case .submitTapped, .retryTapped:
            evaluate()
        }
    }

    private func evaluate() {
        guard let age = UInt16(state.ageText) else {
            state.eligibility = .failed(VotingError.invalidAge)
            return
        }
        state.eligibility = .isLoading(previous: state.eligibility.value)
        do {
            let result = try engine.evaluate(age: age, country: state.countryCode)
            state.eligibility = .loaded(result)
        } catch {
            state.eligibility = .failed(error)
        }
    }
}
```

---

## 3. Controlled Dependencies (Point-Free `SyncUps` Pattern)

To achieve 100% deterministic unit testing and instant SwiftUI Previews without network or system side-effects, dependencies must be abstracted behind swappable interfaces.

### Dependency Injection Pattern

```swift
public struct Dependencies: Sendable {
    public var dateNow: @Sendable () -> Date
    public var uuid: @Sendable () -> UUID
    public var apiClient: APIClientProtocol

    public static let live = Dependencies(
        dateNow: { Date() },
        uuid: { UUID() },
        apiClient: LiveAPIClient()
    )

    public static let mock = Dependencies(
        dateNow: { Date(timeIntervalSince1970: 1_700_000_000) },
        uuid: { UUID(uuidString: "00000000-0000-0000-0000-000000000001")! },
        apiClient: MockAPIClient()
    )
}
```

---

## 4. Anti-Patterns to Avoid

| Anti-Pattern                                       | Why It Fails in Production                                                     | Correct Pattern                                      |
| :------------------------------------------------- | :----------------------------------------------------------------------------- | :--------------------------------------------------- |
| `class ViewModel: ObservableObject` + `@Published` | Excessive view re-renders, higher memory footprint, deprecated in modern Swift | Use `@Observable class ViewModel` (Swift 5.9+)       |
| `isLoading: Bool`, `error: String?`, `data: T?`    | Impossible state desynchronization (e.g. `isLoading && error != nil`)          | Use `Loadable<T>` enum as the single source of truth |
| `Task.detached { await vm.update() }`              | Bypasses structured concurrency, outlives view context, breaks thread safety   | Use `.task` view modifier or actor methods           |
| Force unwraps (`!`) in ViewModels                  | Unhandled runtime crashes in production                                        | Use `guard let`, `if let`, or typed error throwing   |
