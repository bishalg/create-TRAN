// Verifies: REQ-DB-011 REQ-DB-012
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_CONFIG_SCHEMA,
  MemoryConfigStorage,
  RemoteConfigStore,
  STORAGE_KEY_CONFIG,
  storedRecordDecision,
} from '../src/remote-config.js';

interface FixtureData {
  currentSchemas: {
    config: number;
  };
  decisions: Array<{
    name: string;
    schema: number;
    current: number;
    action: 'use' | 'upgrade' | 'discard';
  }>;
  records: {
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

describe('API stored record versioning and recovery (REQ-DB-011, REQ-DB-012)', () => {
  it('current config schema matches fixture', () => {
    expect(CURRENT_CONFIG_SCHEMA).toBe(fixture.currentSchemas.config);
  });

  it('storedRecordDecision matches all fixture decision cases', () => {
    for (const c of fixture.decisions) {
      expect(storedRecordDecision(c.schema, c.current), c.name).toBe(c.action);
    }
  });

  it('storedRecordDecision handles edge case numeric inputs', () => {
    expect(storedRecordDecision(0, 2)).toBe('discard');
    expect(storedRecordDecision(-1, 2)).toBe('discard');
    expect(storedRecordDecision(1, 0)).toBe('discard');
    expect(storedRecordDecision(1.5, 2)).toBe('discard');
    expect(storedRecordDecision(1, 2.5)).toBe('discard');
    expect(storedRecordDecision(NaN, 2)).toBe('discard');
  });

  it('reads every kept config version from fixture', () => {
    for (const c of fixture.records.config) {
      const storage = new MemoryConfigStorage();
      storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(c.raw));

      const store = new RemoteConfigStore({
        baseUrl: 'http://api.test',
        storage,
        defaults: { notify_me: false },
      });

      if (c.expected === null) {
        expect(store.isNotifyMe(), `${c.name}: should fall back to default`).toBe(false);
        expect(store.getConfigVersion(), `${c.name}: config version`).toBe(1);
      } else {
        const expectedFlags = c.expected.flags as Record<string, boolean>;
        expect(store.isNotifyMe(), `${c.name}: flag value`).toBe(expectedFlags.notify_me);
        expect(store.getConfigVersion(), `${c.name}: config version`).toBe(
          c.expected.configVersion
        );
      }
    }
  });

  it('custom injected recordDecision is respected', () => {
    const storage = new MemoryConfigStorage();
    storage.setItem(
      STORAGE_KEY_CONFIG,
      JSON.stringify({ schema: 10, flags: { notify_me: true }, config_version: 5 })
    );

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.test',
      storage,
      recordDecision: (schema) => (schema === 10 ? 'use' : 'discard'),
    });

    expect(store.isNotifyMe()).toBe(true);
    expect(store.getConfigVersion()).toBe(5);
  });

  it('background fetch persists record with current schema', async () => {
    const storage = new MemoryConfigStorage();
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          flags: { notify_me: true },
          client: { minimum_version: '1.0.0', recommended_version: '1.2.0' },
          config_version: 7,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.test',
      storage,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await store.fetchInBackground();

    const savedRaw = storage.getItem(STORAGE_KEY_CONFIG);
    expect(savedRaw).not.toBeNull();
    const saved = JSON.parse(savedRaw!);
    expect(saved.schema).toBe(CURRENT_CONFIG_SCHEMA);
    expect(saved.flags.notify_me).toBe(true);
    expect(saved.config_version).toBe(7);
  });

  it('handles corrupt and unreadable stored items gracefully without crashing', () => {
    const storage = new MemoryConfigStorage();
    storage.setItem(STORAGE_KEY_CONFIG, '{ broken json');

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.test',
      storage,
    });

    expect(store.isNotifyMe()).toBe(false);
    expect(store.getConfigVersion()).toBe(1);

    // Array JSON
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify([1, 2]));
    const store2 = new RemoteConfigStore({ baseUrl: 'http://api.test', storage });
    expect(store2.isNotifyMe()).toBe(false);

    // String primitive JSON
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify('not-an-object'));
    const store3 = new RemoteConfigStore({ baseUrl: 'http://api.test', storage });
    expect(store3.isNotifyMe()).toBe(false);

    // Missing config_version defaults to 1
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({ schema: 2, flags: { notify_me: true } }));
    const store4 = new RemoteConfigStore({ baseUrl: 'http://api.test', storage });
    expect(store4.isNotifyMe()).toBe(true);
    expect(store4.getConfigVersion()).toBe(1);

    // Invalid flags
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify({ schema: 2, flags: 'not-flags-object' }));
    const store5 = new RemoteConfigStore({ baseUrl: 'http://api.test', storage });
    expect(store5.isNotifyMe()).toBe(false);
  });
});
