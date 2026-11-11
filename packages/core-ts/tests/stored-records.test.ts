// Verifies: REQ-DB-011 REQ-DB-012
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  readStoredConfig,
  readStoredPush,
  readStoredSession,
  storedRecord,
  STORED_RECORD_SCHEMAS,
} from '../src/stored-records.js';

interface FixtureData {
  currentSchemas: {
    session: number;
    push: number;
    config: number;
  };
  decisions: Array<{
    name: string;
    schema: number;
    current: number;
    action: 'use' | 'upgrade' | 'discard';
  }>;
  records: {
    session: Array<{
      name: string;
      raw: unknown;
      expected: Record<string, unknown> | null;
    }>;
    push: Array<{
      name: string;
      raw: unknown;
      expected: Record<string, unknown> | null;
    }>;
    config: Array<{
      name: string;
      raw: unknown;
      expected: Record<string, unknown> | null;
    }>;
  };
}

const fixture: FixtureData = JSON.parse(
  readFileSync(new URL('../../../fixtures/stored-records.json', import.meta.url), 'utf8')
);

describe('Stored records versioning and migration parity', () => {
  it('current schema constants match fixture', () => {
    expect(STORED_RECORD_SCHEMAS.session).toBe(fixture.currentSchemas.session);
    expect(STORED_RECORD_SCHEMAS.push).toBe(fixture.currentSchemas.push);
    expect(STORED_RECORD_SCHEMAS.config).toBe(fixture.currentSchemas.config);
  });

  it('storedRecord decisions match all fixture cases', () => {
    for (const c of fixture.decisions) {
      expect(storedRecord(c.schema, c.current), c.name).toBe(c.action);
    }
  });

  it('storedRecord handles edge case inputs', () => {
    expect(storedRecord(-1, 2)).toBe('discard');
    expect(storedRecord(1.5, 2)).toBe('discard');
    expect(storedRecord(1, 2.5)).toBe('discard');
    expect(storedRecord(NaN, 2)).toBe('discard');
  });

  it('session records match all fixture cases (REQ-DB-012)', () => {
    for (const c of fixture.records.session) {
      const result = readStoredSession(c.raw, STORED_RECORD_SCHEMAS.session);
      if (c.expected === null) {
        expect(result, c.name).toBeNull();
      } else {
        expect(result, c.name).toEqual(c.expected);
      }
    }
  });

  it('readStoredSession handles stringified JSON and edge cases', () => {
    const validJsonStr = JSON.stringify({
      schema: 2,
      userId: 'u1',
      role: 'voter',
      refreshToken: 'tok1',
    });
    expect(readStoredSession(validJsonStr)).toEqual({
      schema: 2,
      userId: 'u1',
      role: 'voter',
      refreshToken: 'tok1',
    });

    // camelCase properties
    expect(readStoredSession({ schema: 2, userId: 'u2', role: 'r', refreshToken: 't2' })).toEqual({
      schema: 2,
      userId: 'u2',
      role: 'r',
      refreshToken: 't2',
    });

    expect(readStoredSession(null)).toBeNull();
    expect(readStoredSession(undefined)).toBeNull();
    expect(readStoredSession('invalid json')).toBeNull();
    expect(readStoredSession([1, 2, 3])).toBeNull();
    expect(readStoredSession(JSON.stringify([1, 2]))).toBeNull();
    expect(readStoredSession({ schema: 2, userId: 'u1' })).toBeNull();
    expect(readStoredSession({ schema: 2, userId: 123, role: 'r', refreshToken: 't' })).toBeNull();
    expect(
      readStoredSession({ schema: 2, user_id: 'u', role: 123, refresh_token: 't' })
    ).toBeNull();
    expect(
      readStoredSession({ schema: 2, user_id: 'u', role: 'r', refresh_token: 123 })
    ).toBeNull();
  });

  it('push records match all fixture cases', () => {
    for (const c of fixture.records.push) {
      const result = readStoredPush(c.raw, STORED_RECORD_SCHEMAS.push);
      if (c.expected === null) {
        expect(result, c.name).toBeNull();
      } else {
        expect(result, c.name).toEqual(c.expected);
      }
    }
  });

  it('readStoredPush handles stringified JSON and edge cases', () => {
    const validJsonStr = JSON.stringify({
      schema: 2,
      token: 'tok_push',
      registeredAtUnixS: 123456,
    });
    expect(readStoredPush(validJsonStr)).toEqual({
      schema: 2,
      token: 'tok_push',
      registeredAtUnixS: 123456,
    });

    expect(
      readStoredPush({ schema: 2, token: 'tok_push_2', registered_at_unix_s: 654321 })
    ).toEqual({
      schema: 2,
      token: 'tok_push_2',
      registeredAtUnixS: 654321,
    });

    expect(readStoredPush(null)).toBeNull();
    expect(readStoredPush('invalid json')).toBeNull();
    expect(readStoredPush([])).toBeNull();
    expect(readStoredPush({ schema: 2, token: 'tok' })).toBeNull();
    expect(readStoredPush({ schema: 2, token: 123, registeredAtUnixS: 123 })).toBeNull();
    expect(readStoredPush({ schema: 2, token: 'tok', registeredAtUnixS: 'not-number' })).toBeNull();
  });

  it('config records match all fixture cases', () => {
    for (const c of fixture.records.config) {
      const result = readStoredConfig(c.raw, STORED_RECORD_SCHEMAS.config);
      if (c.expected === null) {
        expect(result, c.name).toBeNull();
      } else {
        expect(result, c.name).toEqual(c.expected);
      }
    }
  });

  it('readStoredConfig handles stringified JSON and edge cases', () => {
    const validJsonStr = JSON.stringify({
      schema: 2,
      flags: { flag1: true },
      client: { minimum_version: '1.0.0', recommended_version: '1.2.0' },
      config_version: 3,
    });
    expect(readStoredConfig(validJsonStr)).toEqual({
      schema: 2,
      flags: { flag1: true },
      client: { minimumVersion: '1.0.0', recommendedVersion: '1.2.0' },
      configVersion: 3,
    });

    // camelCase client thresholds and configVersion
    expect(
      readStoredConfig({
        schema: 2,
        flags: { f1: false },
        client: { minimumVersion: '1.1.0', recommendedVersion: '1.3.0' },
        configVersion: 4,
      })
    ).toEqual({
      schema: 2,
      flags: { f1: false },
      client: { minimumVersion: '1.1.0', recommendedVersion: '1.3.0' },
      configVersion: 4,
    });

    // client thresholds with nulls / empty
    expect(
      readStoredConfig({
        schema: 2,
        flags: { f1: false },
        client: {},
        configVersion: 5,
      })
    ).toEqual({
      schema: 2,
      flags: { f1: false },
      client: { minimumVersion: null, recommendedVersion: null },
      configVersion: 5,
    });

    // client as array or non-object
    expect(
      readStoredConfig({
        schema: 2,
        flags: { f1: false },
        client: [1, 2],
        configVersion: 5,
      })
    ).toEqual({
      schema: 2,
      flags: { f1: false },
      client: undefined,
      configVersion: 5,
    });

    expect(readStoredConfig(null)).toBeNull();
    expect(readStoredConfig('invalid json')).toBeNull();
    expect(readStoredConfig([])).toBeNull();
    expect(readStoredConfig({ schema: 2, flags: null })).toBeNull();
    expect(readStoredConfig({ schema: 2, flags: [] })).toBeNull();
    expect(readStoredConfig({ schema: 2, flags: {} })).toBeNull();
    expect(readStoredConfig({ schema: 2, flags: {}, config_version: 'not-a-number' })).toBeNull();
  });
});
