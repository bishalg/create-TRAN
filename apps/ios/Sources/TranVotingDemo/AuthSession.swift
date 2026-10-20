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
