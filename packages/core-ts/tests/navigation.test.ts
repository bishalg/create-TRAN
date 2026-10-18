import { describe, expect, it } from 'vitest';
import { resolveDestination, type AuthSession } from '../src/navigation.js';

describe('Navigation Director (resolveDestination)', () => {
  it('[REQ-NAV-001] resolves unauthenticated when no session exists', () => {
    expect(resolveDestination(null)).toBe('auth_welcome');
    expect(resolveDestination(undefined)).toBe('auth_welcome');
  });

  it('[REQ-NAV-002] resolves to auth_welcome when session status is unauthenticated', () => {
    const session: AuthSession = { status: 'unauthenticated' };
    expect(resolveDestination(session)).toBe('auth_welcome');
  });

  it('[REQ-NAV-003] routes to voter_dashboard when role is citizen_voter', () => {
    const session: AuthSession = {
      status: 'authenticated',
      userId: 'voter-001',
      role: 'citizen_voter',
    };
    expect(resolveDestination(session)).toBe('voter_dashboard');
  });

  it('[REQ-NAV-004] routes to auditor_dashboard when role is election_auditor', () => {
    const session: AuthSession = {
      status: 'authenticated',
      userId: 'auditor-001',
      role: 'election_auditor',
    };
    expect(resolveDestination(session)).toBe('auditor_dashboard');
  });

  it('[REQ-NAV-005] returns to auth_welcome after session is cleared on sign out', () => {
    let session: AuthSession = {
      status: 'authenticated',
      userId: 'voter-001',
      role: 'citizen_voter',
    };
    expect(resolveDestination(session)).toBe('voter_dashboard');

    // Sign out: transition to unauthenticated
    session = { status: 'unauthenticated' };
    expect(resolveDestination(session)).toBe('auth_welcome');
  });
});
