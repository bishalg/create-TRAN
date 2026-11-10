// Verifies: REQ-PRV-001 REQ-PRV-002 REQ-PRV-008
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_STATUSES,
  PERSONAL_QUESTIONS,
  permissionStep,
  type PermissionStatus,
} from '../src/index.js';

interface PermissionFixtures {
  permissions: Record<string, unknown>[];
  steps: { name: string; status: PermissionStatus; primed: boolean; step: string }[];
  personalQuestions: Record<string, unknown>[];
}

const fixtures: PermissionFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/permissions.json', import.meta.url), 'utf8')
);

describe('permission catalogue (generated from Rust)', () => {
  it('[REQ-PRV-001] matches the fixture', () => {
    expect(PERMISSIONS).toEqual(fixtures.permissions);
  });

  it('[REQ-PRV-008] carries the personal questions of the fixture', () => {
    expect(PERSONAL_QUESTIONS).toEqual(fixtures.personalQuestions);
  });
});

describe('golden permission steps (shared with Rust and native)', () => {
  it.each(fixtures.steps)('[REQ-PRV-002] $name -> $step', (c) => {
    expect(permissionStep(c.status, c.primed)).toBe(c.step);
  });

  it('[REQ-PRV-002] pins every status with and without priming', () => {
    for (const status of PERMISSION_STATUSES) {
      for (const primed of [false, true]) {
        expect(
          fixtures.steps.some((c) => c.status === status && c.primed === primed),
          `${status} ${primed}`
        ).toBe(true);
      }
    }
    expect(fixtures.steps).toHaveLength(PERMISSION_STATUSES.length * 2);
  });
});
