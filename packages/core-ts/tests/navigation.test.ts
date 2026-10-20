// Verifies: REQ-NAV-006
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveDestination, type AuthSession, type UserRole } from '../src/navigation.js';

interface NavigationFixtures {
  destinations: {
    name: string;
    session: 'none' | 'unauthenticated' | UserRole;
    destination: string;
  }[];
}

const fixtures: NavigationFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/navigation.json', import.meta.url), 'utf8')
);

function sessionFrom(
  raw: NavigationFixtures['destinations'][number]['session']
): AuthSession | null {
  if (raw === 'none') return null;
  if (raw === 'unauthenticated') return { status: 'unauthenticated' };
  return { status: 'authenticated', userId: 'fixture-user', role: raw };
}

describe('golden navigation fixtures (shared with Rust and native)', () => {
  it.each(fixtures.destinations)('$name -> $destination', (c) => {
    expect(resolveDestination(sessionFrom(c.session))).toBe(c.destination);
  });
});

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
