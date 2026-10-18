import SwiftUI

/// An asynchronous resource state enum representing the single source of truth for async operations.
/// Inspired by `nalexn/clean-architecture-swiftui`.
public enum Loadable<T: Sendable>: Sendable {
    case notRequested
    case isLoading(previous: T?)
    case loaded(T)
    case failed(Error)

    public var value: T? {
        switch self {
        case .loaded(let value):
            return value
        case .isLoading(let previous):
            return previous
        case .notRequested, .failed:
            return nil
        }
    }

    public var error: Error? {
        if case .failed(let error) = self {
            return error
        }
        return nil
    }

    public var isLoading: Bool {
        if case .isLoading = self {
            return true
        }
        return false
    }

    /// Transforms the wrapped value if loaded or loading with previous value
    public func map<U: Sendable>(_ transform: (T) -> U) -> Loadable<U> {
        switch self {
        case .notRequested:
            return .notRequested
        case .isLoading(let previous):
            return .isLoading(previous: previous.map(transform))
        case .loaded(let value):
            return .loaded(transform(value))
        case .failed(let error):
            return .failed(error)
        }
    }
}

extension Loadable: Equatable where T: Equatable {
    public static func == (lhs: Loadable<T>, rhs: Loadable<T>) -> Bool {
        switch (lhs, rhs) {
        case (.notRequested, .notRequested):
            return true
        case (.isLoading(let lPrev), .isLoading(let rPrev)):
            return lPrev == rPrev
        case (.loaded(let lVal), .loaded(let rVal)):
            return lVal == rVal
        case (.failed(let lErr), .failed(let rErr)):
            return lErr.localizedDescription == rErr.localizedDescription
        default:
            return false
        }
    }
}

// MARK: - SwiftUI View Helpers

public extension Loadable {
    /// Helper view builder to cleanly unpack the loadable states in SwiftUI
    @ViewBuilder
    func render(
        @ViewBuilder onLoading: (T?) -> some View,
        @ViewBuilder onLoaded: (T) -> some View,
        @ViewBuilder onFailed: (Error) -> some View,
        @ViewBuilder onNotRequested: () -> some View = { EmptyView() }
    ) -> some View {
        switch self {
        case .notRequested:
            onNotRequested()
        case .isLoading(let previous):
            onLoading(previous)
        case .loaded(let value):
            onLoaded(value)
        case .failed(let error):
            onFailed(error)
        }
    }
}
