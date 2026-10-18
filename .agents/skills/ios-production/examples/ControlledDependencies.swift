import Foundation
import SwiftUI

/// Protocol defining a dependency container key.
/// Inspired by Point-Free's `swift-dependencies` and `SyncUps`.
public protocol TestableDependencyKey: Sendable {
    associatedtype Value: Sendable
    static var liveValue: Value { get }
    static var testValue: Value { get }
}

/// Global container for swappable dependencies
public struct AppDependencies: Sendable {
    public var dateNow: @Sendable () -> Date
    public var uuid: @Sendable () -> UUID
    public var sleep: @Sendable (Duration) async throws -> Void

    public init(
        dateNow: @escaping @Sendable () -> Date,
        uuid: @escaping @Sendable () -> UUID,
        sleep: @escaping @Sendable (Duration) async throws -> Void
    ) {
        self.dateNow = dateNow
        self.uuid = uuid
        self.sleep = sleep
    }

    /// Production runtime dependencies
    public static let live = AppDependencies(
        dateNow: { Date() },
        uuid: { UUID() },
        sleep: { duration in
            try await Task.sleep(for: duration)
        }
    )

    /// Deterministic test dependencies
    public static let test = AppDependencies(
        dateNow: { Date(timeIntervalSince1970: 1_700_000_000) },
        uuid: { UUID(uuidString: "00000000-0000-0000-0000-000000000001") ?? UUID() },
        sleep: { _ in /* No-op in unit tests to execute instantly */ }
    )
}

// MARK: - SwiftUI Environment Injection

private struct DependenciesKey: EnvironmentKey {
    static let defaultValue: AppDependencies = .live
}

public extension EnvironmentValues {
    var dependencies: AppDependencies {
        get { self[DependenciesKey.self] }
        set { self[DependenciesKey.self] = newValue }
    }
}
