package com.tran.voting.ui

/**
 * Navigation Director and role-based branching models for TRAN Android.
 *
 * Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
 */
enum class UserRole(val label: String) {
    CITIZEN_VOTER("Citizen Voter"),
    ELECTION_AUDITOR("Election Auditor")
}

sealed interface AuthSession {
    data object Unauthenticated : AuthSession
    data class Authenticated(val userId: String, val role: UserRole) : AuthSession
}

enum class AppDestination {
    SPLASH,
    AUTH_WELCOME,
    VOTER_DASHBOARD,
    AUDITOR_DASHBOARD
}

object NavigationDirector {
    fun resolveDestination(session: AuthSession): AppDestination {
        return when (session) {
            is AuthSession.Unauthenticated -> AppDestination.AUTH_WELCOME
            is AuthSession.Authenticated -> {
                when (session.role) {
                    UserRole.CITIZEN_VOTER -> AppDestination.VOTER_DASHBOARD
                    UserRole.ELECTION_AUDITOR -> AppDestination.AUDITOR_DASHBOARD
                }
            }
        }
    }
}
