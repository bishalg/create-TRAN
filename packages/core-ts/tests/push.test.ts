// Verifies: REQ-PSH-005 REQ-PSH-009
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEVICE_POLICY, pushSync, type PushState } from '../src/index.js';

interface PushFixtures {
  policy: { staleAfterDays: number; refreshAfterDays: number };
  sync: (PushState & { name: string; action: string })[];
}

const fixtures: PushFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/push.json', import.meta.url), 'utf8')
);

describe('device policy (generated from Rust)', () => {
  it('[REQ-PSH-005] matches the fixture', () => {
    expect(DEVICE_POLICY).toEqual(fixtures.policy);
  });
});

describe('golden push sync table (shared with Rust and native)', () => {
  it.each(fixtures.sync)('[REQ-PSH-009] $name -> $action', ({ name: _name, action, ...state }) => {
    expect(pushSync(state)).toBe(action);
  });
});
