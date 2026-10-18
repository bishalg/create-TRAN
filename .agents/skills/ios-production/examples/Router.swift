import SwiftUI
import Observation

/// Centralized navigation and presentation coordinator for modern SwiftUI applications.
/// Inspired by `Dimillian/IceCubesApp` (`Packages/Env/Router.swift`).
@Observable
@MainActor
public final class Router {
    /// The active navigation path stack
    public var path = NavigationPath()

    /// The currently presented modal sheet, if any
    public var presentedSheet: AppSheet?

    /// The currently presented full-screen modal cover, if any
    public var presentedCover: AppCover?

    /// The currently active alert dialog payload, if any
    public var presentedAlert: AppAlert?

    public init() {}

    // MARK: - Navigation Operations

    /// Pushes a new destination onto the navigation stack
    public func navigate<D: Hashable & Sendable>(to destination: D) {
        path.append(destination)
    }

    /// Pops the top-most view off the navigation stack
    public func pop() {
        guard !path.isEmpty else { return }
        path.removeLast()
    }

    /// Pops back to the root of the active navigation stack
    public func popToRoot() {
        path = NavigationPath()
    }

    // MARK: - Presentation Operations

    /// Presents a modal sheet
    public func present(sheet: AppSheet) {
        self.presentedSheet = sheet
    }

    /// Dismisses any active modal sheet
    public func dismissSheet() {
        self.presentedSheet = nil
    }

    /// Presents a full screen cover
    public func present(cover: AppCover) {
        self.presentedCover = cover
    }

    /// Dismisses any active full screen cover
    public func dismissCover() {
        self.presentedCover = nil
    }

    /// Presents an alert dialog
    public func present(alert: AppAlert) {
        self.presentedAlert = alert
    }

    /// Dismisses any active alert
    public func dismissAlert() {
        self.presentedAlert = nil
    }
}

// MARK: - Destination Protocols & Types

public protocol IdentifiableDestination: Identifiable, Sendable {
    var id: String { get }
}

public enum AppSheet: IdentifiableDestination {
    case info(title: String, message: String)
    case custom(id: String)

    public var id: String {
        switch self {
        case .info(let title, _): "info-\(title)"
        case .custom(let id): id
        }
    }
}

public enum AppCover: IdentifiableDestination {
    case onboarding
    case authentication

    public var id: String {
        switch self {
        case .onboarding: "onboarding"
        case .authentication: "auth"
        }
    }
}

public struct AppAlert: Identifiable, Sendable {
    public let id: UUID
    public let title: String
    public let message: String
    public let dismissButtonTitle: String

    public init(id: UUID = UUID(), title: String, message: String, dismissButtonTitle: String = "OK") {
        self.id = id
        self.title = title
        self.message = message
        self.dismissButtonTitle = dismissButtonTitle
    }
}
