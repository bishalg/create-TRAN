// Verifies: REQ-CFG-001 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
import { CLIENT_HEADER } from '@tran/api';
import { describe, expect, it, vi } from 'vitest';
import {
  BUCKET_HEADER,
  CONFIG_PATH,
  MemoryConfigStorage,
  RemoteConfigStore,
  STORAGE_KEY_CONFIG,
  STORED_RECORD_SCHEMAS,
} from '../src/index.js';

const BASE = 'http://api.example';
const NO_THRESHOLDS = { minimum_version: null, recommended_version: null };

const answer = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

const config = (flags: Record<string, unknown>, version = 2, client: unknown = NO_THRESHOLDS) => ({
  config_version: version,
  flags,
  client,
});

function stored(record: unknown) {
  const storage = new MemoryConfigStorage();
  storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(record));
  return storage;
}

const current = STORED_RECORD_SCHEMAS.config;

describe('RemoteConfigStore starts without waiting (REQ-CFG-005)', () => {
  it('starts on the compiled defaults when nothing is stored', () => {
    const store = new RemoteConfigStore({ baseUrl: BASE });
    expect(store.flags).toEqual({ notifyMe: false });
    expect(store.getConfigVersion()).toBe(1);
    expect(store.getClientThresholds()).toEqual(NO_THRESHOLDS);
  });

  it('starts on the stored configuration', () => {
    const storage = stored({
      schema: current,
      ...config({ notify_me: true }, 5, { minimum_version: '1.2.0', recommended_version: '1.4.0' }),
    });
    const store = new RemoteConfigStore({ baseUrl: BASE, storage });
    expect(store.flags.notifyMe).toBe(true);
    expect(store.getConfigVersion()).toBe(5);
    expect(store.getClientThresholds()).toEqual({
      minimum_version: '1.2.0',
      recommended_version: '1.4.0',
    });
  });

  it('a stored record with unreadable thresholds keeps its flags', () => {
    const storage = stored({ schema: current, ...config({ notify_me: true }, 4, 'junk') });
    const store = new RemoteConfigStore({ baseUrl: BASE, storage });
    expect(store.flags.notifyMe).toBe(true);
    expect(store.getClientThresholds()).toEqual(NO_THRESHOLDS);
  });

  it.each([
    '{invalid json',
    '[1,2]',
    '"text"',
    'null',
    '{"schema":"2","flags":{},"config_version":1}',
  ])('an unreadable stored record (%s) is deleted and the defaults are used', (raw) => {
    const storage = new MemoryConfigStorage();
    storage.setItem(STORAGE_KEY_CONFIG, raw);
    const store = new RemoteConfigStore({ baseUrl: BASE, storage });
    expect(store.flags.notifyMe).toBe(false);
    expect(storage.getItem(STORAGE_KEY_CONFIG)).toBeNull();
  });

  it('a record from a newer build is left in place, unread', () => {
    const raw = JSON.stringify({ schema: current + 1, ...config({ notify_me: true }, 9) });
    const storage = new MemoryConfigStorage();
    storage.setItem(STORAGE_KEY_CONFIG, raw);
    const store = new RemoteConfigStore({ baseUrl: BASE, storage });
    expect(store.flags.notifyMe).toBe(false);
    expect(storage.getItem(STORAGE_KEY_CONFIG)).toBe(raw);
  });
});

describe('RemoteConfigStore fetches in the background (REQ-CFG-005, REQ-CFG-006, REQ-CFG-008)', () => {
  it('sends client, bucket and no cookie, then applies and stores the answer', async () => {
    const storage = new MemoryConfigStorage();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      answer(
        config({ notify_me: true }, 2, { minimum_version: '1.5.0', recommended_version: '1.6.0' }),
        {
          headers: { etag: '"abc123"' },
        }
      )
    );
    const store = new RemoteConfigStore({
      baseUrl: `${BASE}/`,
      storage,
      fetch: fetch as unknown as typeof globalThis.fetch,
      clientHeader: 'web/1.0.0',
      bucket: 42,
    });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(await store.fetchInBackground()).toBe(true);

    const [url, init] = fetch.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(url).toBe(`${BASE}${CONFIG_PATH}`);
    expect(headers.get(CLIENT_HEADER)).toBe('web/1.0.0');
    expect(headers.get(BUCKET_HEADER)).toBe('42');
    expect(headers.get('if-none-match')).toBeNull();
    expect(init.credentials).toBe('omit');
    expect(store.flags.notifyMe).toBe(true);
    expect(store.getConfigVersion()).toBe(2);
    expect(store.getClientThresholds()).toEqual({
      minimum_version: '1.5.0',
      recommended_version: '1.6.0',
    });
    expect(listener).toHaveBeenCalledWith({ notifyMe: true });
    expect(JSON.parse(storage.getItem(STORAGE_KEY_CONFIG)!)).toEqual({
      ...config({ notify_me: true }, 2, { minimum_version: '1.5.0', recommended_version: '1.6.0' }),
      etag: '"abc123"',
      schema: current,
    });
  });

  it('sends no client or bucket header it was not given', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer(config({})));
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await store.fetchInBackground();
    expect(new Headers(fetch.mock.calls[0]![1].headers).has(BUCKET_HEADER)).toBe(false);
    expect(new Headers(fetch.mock.calls[0]![1].headers).has(CLIENT_HEADER)).toBe(false);
  });

  it('revalidates a stored record with its own ETag and keeps it on 304', async () => {
    const storage = stored({ schema: current, ...config({ notify_me: true }, 3), etag: '"v3"' });
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(null, { status: 304 })
    );
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      storage,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(await store.fetchInBackground()).toBe(false);
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('if-none-match')).toBe('"v3"');
    expect(store.flags.notifyMe).toBe(true);
  });

  it('the next fetch revalidates with the ETag of the last answer', async () => {
    const tags: (string | null)[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      tags.push(new Headers(init.headers).get('if-none-match'));
      return answer(config({ notify_me: true }), { headers: { etag: '"next"' } });
    });
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await store.fetchInBackground();
    await store.fetchInBackground();
    expect(tags).toEqual([null, '"next"']);
  });

  it.each([
    ['a corrupt record', '{broken'],
    [
      'a record from a newer build',
      JSON.stringify({ schema: current + 1, ...config({}, 9), etag: '"v9"' }),
    ],
  ])(
    'after discarding %s it sends no If-None-Match, so it cannot stay on defaults',
    async (_n, raw) => {
      const storage = new MemoryConfigStorage();
      storage.setItem(STORAGE_KEY_CONFIG, raw);
      // The key the previous release kept its ETag under, outside the record.
      storage.setItem('tran:remote_config_etag', '"v9"');
      const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
        answer(config({ notify_me: true }))
      );
      const store = new RemoteConfigStore({
        baseUrl: BASE,
        storage,
        fetch: fetch as unknown as typeof globalThis.fetch,
      });
      expect(await store.fetchInBackground()).toBe(true);
      expect(new Headers(fetch.mock.calls[0]![1].headers).has('if-none-match')).toBe(false);
      expect(store.flags.notifyMe).toBe(true);
    }
  );

  it.each([
    ['the string "false"', 'false'],
    ['the string "true"', 'true'],
    ['the number 1', 1],
  ])('a wrong-typed flag value (%s) reads as the default', async (_n, value) => {
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      fetch: (async () => answer(config({ notify_me: value }))) as typeof globalThis.fetch,
    });
    expect(await store.fetchInBackground()).toBe(true);
    expect(store.flags.notifyMe).toBe(false);
  });

  it('ignores unknown fields and flags, and a server `schema` cannot overwrite the stamp', async () => {
    const storage = new MemoryConfigStorage();
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      storage,
      fetch: (async () =>
        answer({
          ...config({ notify_me: true, future_flag: 'x' }),
          schema: 99,
          extra: { nested: true },
        })) as typeof globalThis.fetch,
    });
    expect(await store.fetchInBackground()).toBe(true);
    expect(store.flags).toEqual({ notifyMe: true });
    const saved = JSON.parse(storage.getItem(STORAGE_KEY_CONFIG)!);
    expect(saved.schema).toBe(current);
    expect(saved.extra).toBeUndefined();
    // The next launch reads what was stored.
    expect(new RemoteConfigStore({ baseUrl: BASE, storage }).flags.notifyMe).toBe(true);
  });

  it.each([
    ['not JSON', new Response('oops', { status: 200 })],
    ['no flags', answer({ config_version: 2, client: NO_THRESHOLDS })],
    ['a string version', answer({ ...config({}), config_version: 'two' })],
  ])('an answer that is %s is ignored and the stored config stays', async (_n, response) => {
    const storage = stored({ schema: current, ...config({ notify_me: true }, 3) });
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      storage,
      fetch: (async () => response) as typeof globalThis.fetch,
    });
    expect(await store.fetchInBackground()).toBe(false);
    expect(store.flags.notifyMe).toBe(true);
    expect(store.getConfigVersion()).toBe(3);
  });

  it('a failed fetch or a 500 leaves the stored config in use and never throws', async () => {
    const storage = stored({ schema: current, ...config({ notify_me: true }, 3) });
    for (const fetch of [
      vi.fn().mockRejectedValue(new Error('offline')),
      vi.fn().mockResolvedValue(new Response('boom', { status: 500 })),
    ]) {
      const store = new RemoteConfigStore({ baseUrl: BASE, storage, fetch });
      await expect(store.fetchInBackground()).resolves.toBe(false);
      expect(store.flags.notifyMe).toBe(true);
    }
  });

  it('keeps the answer in memory when storage refuses to save it', async () => {
    const storage = new MemoryConfigStorage();
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      storage,
      fetch: (async () => answer(config({ notify_me: true }))) as typeof globalThis.fetch,
    });
    expect(await store.fetchInBackground()).toBe(true);
    expect(store.flags.notifyMe).toBe(true);
  });

  it('shares one fetch while one is in flight', async () => {
    let resolve!: (r: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const store = new RemoteConfigStore({ baseUrl: BASE, fetch });
    const p1 = store.fetchInBackground();
    expect(store.fetchInBackground()).toBe(p1);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(answer(config({})));
    await expect(p1).resolves.toBe(true);
    store.fetchInBackground();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a throwing listener does not fail the store; an unsubscribed one is not told', async () => {
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      fetch: (async () => answer(config({ notify_me: true }))) as typeof globalThis.fetch,
    });
    const broken = vi.fn(() => {
      throw new Error('boom');
    });
    const gone = vi.fn();
    store.subscribe(broken);
    store.subscribe(gone)();
    expect(await store.fetchInBackground()).toBe(true);
    expect(broken).toHaveBeenCalled();
    expect(gone).not.toHaveBeenCalled();
  });
});

describe('a flag read at launch keeps its value for the run (REQ-CFG-005)', () => {
  it('the reader gets the launch values and the latest values apart', async () => {
    const storage = stored({ schema: current, ...config({ notify_me: false }, 3) });
    const read = vi.fn((launch: unknown, latest: unknown) => ({ launch, latest }));
    const store = new RemoteConfigStore({
      baseUrl: BASE,
      storage,
      fetch: (async () => answer(config({ notify_me: true }))) as typeof globalThis.fetch,
      readFlags: read,
    });
    await store.fetchInBackground();
    expect(store.flags).toEqual({ launch: { notify_me: false }, latest: { notify_me: true } });
  });
});
