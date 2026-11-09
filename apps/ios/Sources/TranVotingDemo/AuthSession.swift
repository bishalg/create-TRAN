import Foundation

/// Session state the app stores. Where a session leads is decided by `rust-core` through UniFFI
/// (`resolveDestinationOffline`, pinned by `fixtures/navigation.json`) — never re-implemented here.
public enum AuthSession: Equatable, Sendable {
    case unauthenticated
    case authenticated(role: TranUserRole)

    /// The signed-in role, or `nil` after sign-out.
    public var role: TranUserRole? {
        switch self {
        case .unauthenticated: return nil
        case .authenticated(let role): return role
        }
    }

    /// The screen this session leads to, resolved by the shared Rust navigation director.
    public var destination: TranAppDestination {
        resolveDestinationOffline(role: role)
    }
}

extension AuthSession {
    static let launchPresetKey = "TranSession"

    /// Debug-only stored-session preset for the UI tests (`-TranSession citizen_voter`), named as
    /// the screen contract's `session` given names it (ADR-0038): `none`, `unauthenticated`,
    /// `citizen_voter` or `election_auditor`. `nil` when no preset is set or it is unknown; the
    /// inner `nil` is `none`, no stored session at all. A release build never reads it.
    static func launchPreset(defaults: UserDefaults = .standard) -> AuthSession?? {
        #if DEBUG
            switch defaults.string(forKey: launchPresetKey) {
            case "none": return .some(nil)
            case "unauthenticated": return .some(.unauthenticated)
            case "citizen_voter": return .some(.authenticated(role: .citizenVoter))
            case "election_auditor": return .some(.authenticated(role: .electionAuditor))
            default: return nil
            }
        #else
            return nil
        #endif
    }
}
