/**
 * Central Navigation Director and role-based branching models.
 * Mirrors `crates/rust-core/src/navigation.rs`.
 *
 * Verifies: REQ-NAV-001 REQ-NAV-002 REQ-NAV-003 REQ-NAV-004 REQ-NAV-005
 */

export type UserRole = 'citizen_voter' | 'election_auditor';

export type AuthSession =
  { status: 'unauthenticated' } | { status: 'authenticated'; userId: string; role: UserRole };

export type AppDestination = 'splash' | 'auth_welcome' | 'voter_dashboard' | 'auditor_dashboard';

/**
 * Central Navigation Director resolving the target destination from stored session state.
 */
export function resolveDestination(session?: AuthSession | null): AppDestination {
  if (!session || session.status === 'unauthenticated') {
    return 'auth_welcome';
  }

  if (session.role === 'citizen_voter') {
    return 'voter_dashboard';
  }

  return 'auditor_dashboard';
}
