// Verifies: REQ-DB-011 REQ-DB-012
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import {
  FLAGS,
  MemoryConfigStorage,
  RemoteConfigStore,
  STORAGE_KEY_CONFIG,
  storedRecord,
  storedSchema,
  STORED_RECORD_SCHEMAS,
} from '../src/index.js';

interface KeptRecord {
  name: string;
  raw: unknown;
  expected: {
    flags: Record<string, unknown>;
    client?: { minimumVersion?: string | null; recommendedVersion?: string | null } | null;
    configVersion: number;
  } | null;
  /** Whether the record is still stored after the read. */
  kept: boolean;
}

interface FixtureData {
  currentSchemas: Record<'session' | 'push' | 'config', number>;
  decisions: { name: string; schema: number; current: number; action: string }[];
  records: { config: KeptRecord[] };
}

const fixture: FixtureData = JSON.parse(
  readFileSync(new URL('../../../fixtures/stored-records.json', import.meta.url), 'utf8')
);

describe('the one stored-record decision (REQ-DB-011)', () => {
  it('current schemas come from Rust and match the fixture', () => {
    expect(STORED_RECORD_SCHEMAS).toEqual(fixture.currentSchemas);
  });

  it('matches every fixture decision', () => {
    for (const c of fixture.decisions) {
      expect(storedRecord(c.schema, c.current), c.name).toBe(c.action);
    }
  });

  it('discards what is not a positive whole number', () => {
    for (const [schema, current] of [
      [0, 2],
      [-1, 2],
      [1, 0],
      [1.5, 2],
      [1, 2.5],
      [NaN, 2],
    ] as const) {
      expect(storedRecord(schema, current), `${schema}/${current}`).toBe('discard');
    }
  });

  it('a stored schema is a whole number from 1 to 2^32 − 1, or absent (the first release)', () => {
    expect(storedSchema(undefined)).toBe(1);
    expect(storedSchema(2)).toBe(2);
    expect(storedSchema(4294967295)).toBe(4294967295);
    for (const value of ['2', -1, 1.5, 0, 4294967296, null, true, [2], { v: 2 }]) {
      expect(storedSchema(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('no hand-written reader of another platform record is left', () => {
    for (const name of ['readStoredSession', 'readStoredPush', 'readStoredConfig']) {
      expect(Object.keys(core), name).not.toContain(name);
    }
  });
});

describe('the web keeps every config record a past release stored (REQ-DB-012)', () => {
  it.each(fixture.records.config)('$name', ({ raw, expected, kept }) => {
    const storage = new MemoryConfigStorage();
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(raw));
    const store = new RemoteConfigStore({ baseUrl: 'http://api.test', storage });

    // Only an unreadable record is deleted; a newer one is left for the build that wrote it.
    expect(storage.getItem(STORAGE_KEY_CONFIG) !== null).toBe(kept);
    if (expected === null) {
      expect(store.flags).toEqual({ notifyMe: FLAGS.notifyMe.defaultValue });
      expect(store.getConfigVersion()).toBe(1);
      return;
    }
    for (const [name, accessor] of Object.entries(FLAGS)) {
      expect(store.flags[name as keyof typeof FLAGS]).toBe(accessor.get(expected.flags));
    }
    expect(store.getConfigVersion()).toBe(expected.configVersion);
    expect(store.getClientThresholds()).toEqual({
      minimum_version: expected.client?.minimumVersion ?? null,
      recommended_version: expected.client?.recommendedVersion ?? null,
    });
  });
});
