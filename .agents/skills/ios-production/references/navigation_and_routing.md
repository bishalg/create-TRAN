# Navigation & Routing Guide

This guide establishes the decoupling pattern for SwiftUI navigation, sheets, and modal flows. Based on **Dimillian's IceCubesApp (`Packages/Env/Router.swift`)**, this architecture removes view-to-view coupling, supports programmatic deep linking, and keeps views reusable across navigation contexts.

---

## 1. Architectural Overview

```
+-----------------------------------------------------------+
|                      NavigationRoot                       |
|   NavigationStack(path: $router.path)                     |
|     .navigationDestination(for: Destination.self)         |
|     .sheet(item: $router.presentedSheet)                  |
|     .fullScreenCover(item: $router.presentedCover)        |
+-----------------------------------------------------------+
                             |
         Injected via @Environment(Router.self)
                             v
+-----------------------------------------------------------+
|                        Child View                         |
|   Button("View Profile") {                                |
|       router.navigate(to: .profile(userId: "123"))        |
|   }                                                       |
+-----------------------------------------------------------+
```

### Why Legacy `NavigationLink(destination:)` Fails

1. **Tight View Coupling**: Child views must know the exact destination type and initialize it inline, even if the destination is never visited.
2. **Double Evaluation**: Inline destination views evaluate their body or state prematurely in Lists or Grids.
3. **Deep Linking Inflexibility**: Handling deep links or universal links requires traversing complex view hierarchies.

---

## 2. Implementing the Router

### Step 1: Define Value-Type Destinations

All navigation targets must be value types conforming to `Hashable` and `Identifiable`:

```swift
import SwiftUI

public enum NavigationDestination: Hashable, Sendable {
    case electionDetail(id: String)
    case candidateProfile(id: String, name: String)
    case ballotAudit(ballotHash: String)
    case settings
}

public enum SheetDestination: Identifiable, Sendable {
    case voteVerification(candidateId: String)
    case biometricPrompt(reason: String)
    case termsOfService

    public var id: String {
        switch self {
        case .voteVerification(let id): "verify-\(id)"
        case .biometricPrompt(let reason): "bio-\(reason)"
        case .termsOfService: "terms"
        }
    }
}
```

### Step 2: The Observable Router Engine

```swift
import SwiftUI
import Observation

@Observable
@MainActor
public final class Router {
    public var path = NavigationPath()
    public var presentedSheet: SheetDestination?
    public var presentedCover: SheetDestination?

    public init() {}

    public func navigate(to destination: NavigationDestination) {
        path.append(destination)
    }

    public func pop() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    public func popToRoot() {
        path = NavigationPath()
    }

    public func presentSheet(_ sheet: SheetDestination) {
        presentedSheet = sheet
    }

    public func dismissSheet() {
        presentedSheet = nil
    }

    /// Handles deep link URLs: tran://app/election/123 -> .electionDetail(id: "123")
    public func handleDeepLink(url: URL) -> Bool {
        guard url.scheme == "tran", let host = url.host else { return false }
        switch host {
        case "election":
            let id = url.lastPathComponent
            navigate(to: .electionDetail(id: id))
            return true
        case "settings":
            navigate(to: .settings)
            return true
        default:
            return false
        }
    }
}
```

---

## 3. Assembling the Root Container

Place the router at the application root or tab root and inject it into the SwiftUI environment:

```swift
struct MainAppRootView: View {
    @State private var router = Router()

    var body: some View {
        NavigationStack(path: $router.path) {
            VotingHomeView()
                .navigationDestination(for: NavigationDestination.self) { destination in
                    switch destination {
                    case .electionDetail(let id):
                        ElectionDetailView(electionId: id)
                    case .candidateProfile(let id, let name):
                        CandidateProfileView(id: id, name: name)
                    case .ballotAudit(let hash):
                        BallotAuditView(ballotHash: hash)
                    case .settings:
                        SettingsView()
                    }
                }
        }
        .sheet(item: $router.presentedSheet) { sheet in
            switch sheet {
            case .voteVerification(let candidateId):
                VoteVerificationSheet(candidateId: candidateId)
            case .biometricPrompt(let reason):
                BiometricPromptSheet(reason: reason)
            case .termsOfService:
                TermsOfServiceSheet()
            }
        }
        .environment(router)
        .onOpenURL { url in
            _ = router.handleDeepLink(url: url)
        }
    }
}
```

---

## 4. Consuming the Router in Child Views

Child views simply access `@Environment(Router.self)` without depending on parent or destination view types:

```swift
struct CandidateRowView: View {
    @Environment(Router.self) private var router
    let candidate: Candidate

    var body: some View {
        HStack {
            Text(candidate.name)
                .font(.headline)
            Spacer()
            Button("Verify") {
                router.presentSheet(.voteVerification(candidateId: candidate.id))
            }
            .buttonStyle(.bordered)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            router.navigate(to: .candidateProfile(id: candidate.id, name: candidate.name))
        }
    }
}
```

---

## 5. Summary of Best Practices

- **Never create multiple `NavigationStack`s inside one tab hierarchy**: Exactly one `NavigationStack` per tab.
- **Pass IDs, not heavy models**: Pass identifiers (e.g. `electionId: String`) in destinations rather than heavy non-hashable models. Let the destination view or ViewModel load/observe the entity.
- **Support Universal Links & Deep Links**: Keep all URL-to-destination parsing logic centralized in the `Router`.
