import SwiftUI

/// User role branching for TRAN iOS application.
/// Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
public enum UserRole: String, Sendable, CaseIterable {
    case citizenVoter = "Citizen Voter"
    case electionAuditor = "Election Auditor"
}

public enum AuthSession: Equatable, Sendable {
    case unauthenticated
    case authenticated(role: UserRole)
}

public enum AppDestination: Hashable, Sendable {
    case splash
    case authWelcome
    case voterDashboard
    case auditorDashboard
}

/// Central Navigation Director deciding the active screen from stored session.
public struct NavigationDirector {
    public static func resolveDestination(session: AuthSession) -> AppDestination {
        switch session {
        case .unauthenticated:
            return .authWelcome
        case .authenticated(let role):
            switch role {
            case .citizenVoter:
                return .voterDashboard
            case .electionAuditor:
                return .auditorDashboard
            }
        }
    }
}
