// Verifies: REQ-SEC-005 REQ-SEC-015
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SESSION_POLICY, refreshEvent, sessionRecovery, type SessionEvent } from '../src/index.js';

interface SessionFixtures {
  policy: { accessTtlSeconds: number; refreshTtlSeconds: number; tokenBytes: number };
  recovery: {
    name: string;
    event: SessionEvent['kind'];
    hasRefreshCredential?: boolean;
    alreadyRetried?: boolean;
    action: string;
  }[];
  refreshResponses: { name: string; status: number | null; event: string | null }[];
}

const fixtures: SessionFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/session.json', import.meta.url), 'utf8')
);

function eventFrom(c: SessionFixtures['recovery'][number]): SessionEvent {
  if (c.event === 'unauthorized') {
    return {
      kind: 'unauthorized',
      hasRefreshCredential: c.hasRefreshCredential ?? false,
      alreadyRetried: c.alreadyRetried ?? false,
    };
  }
  return { kind: c.event };
}

describe('session policy (generated from Rust)', () => {
  it('[REQ-SEC-005] matches the fixture', () => {
    expect(SESSION_POLICY).toEqual(fixtures.policy);
  });
});

describe('golden session recovery fixtures (shared with Rust and native)', () => {
  it.each(fixtures.recovery)('[REQ-SEC-015] $name -> $action', (c) => {
    expect(sessionRecovery(eventFrom(c))).toBe(c.action);
  });

  it.each(fixtures.refreshResponses)('[REQ-SEC-015] refresh $name -> $event', (c) => {
    expect(refreshEvent(c.status)?.kind ?? null).toBe(c.event);
  });
});
