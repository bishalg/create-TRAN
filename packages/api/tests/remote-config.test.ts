// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
import { describe, expect, it, vi } from 'vitest';
import {
  BUCKET_HEADER,
  CONFIG_PATH,
  MemoryConfigStorage,
  RemoteConfigStore,
  STORAGE_KEY_CONFIG,
  STORAGE_KEY_ETAG,
} from '../src/remote-config.js';
import { CLIENT_HEADER } from '../src/generated/compat.js';

describe('RemoteConfigStore (REQ-CFG-005, REQ-CFG-007, REQ-CFG-008)', () => {
  it('starts with compiled defaults when storage is empty', () => {
    const storage = new MemoryConfigStorage();
    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
    });

    expect(store.isNotifyMe()).toBe(false);
    expect(store.getFlag('notify_me')).toBe(false);
    expect(store.getConfigVersion()).toBe(1);
    expect(store.getClientThresholds()).toEqual({
      minimum_version: null,
      recommended_version: null,
    });
  });

  it('starts with stored configuration from storage', () => {
    const storage = new MemoryConfigStorage();
    storage.setItem(
      STORAGE_KEY_CONFIG,
      JSON.stringify({
        config_version: 5,
        flags: { notify_me: true },
        client: { minimum_version: '1.2.0', recommended_version: '1.4.0' },
      })
    );

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
    });

    expect(store.isNotifyMe()).toBe(true);
    expect(store.getConfigVersion()).toBe(5);
    expect(store.getClientThresholds()).toEqual({
      minimum_version: '1.2.0',
      recommended_version: '1.4.0',
    });
  });

  it('fetches in background, passes headers, and updates live flags on 200', async () => {
    const storage = new MemoryConfigStorage();
    let sentHeaders: Headers | undefined;
    let requestedUrl = '';

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      requestedUrl = url;
      sentHeaders = new Headers(init.headers);
      return new Response(
        JSON.stringify({
          config_version: 2,
          flags: { notify_me: true, non_live_flag: 'new_value' },
          client: { minimum_version: '1.5.0', recommended_version: '1.6.0' },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"abc123"',
          },
        }
      );
    });

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
      fetch: mockFetch,
      clientHeader: 'web/1.0.0',
      bucket: 42,
      defaults: { non_live_flag: 'old_value' },
      liveFlags: ['notify_me'],
    });

    // Before fetch
    expect(store.isNotifyMe()).toBe(false);
    expect(store.getFlag('non_live_flag')).toBe('old_value');

    const listener = vi.fn();
    store.subscribe(listener);

    const updated = await store.fetchInBackground();
    expect(updated).toBe(true);

    expect(requestedUrl).toBe(`http://api.example${CONFIG_PATH}`);
    expect(sentHeaders?.get(CLIENT_HEADER)).toBe('web/1.0.0');
    expect(sentHeaders?.get(BUCKET_HEADER)).toBe('42');

    // Live flag is updated immediately
    expect(store.isNotifyMe()).toBe(true);
    // Non-live flag read at launch stays stable for the run (REQ-CFG-005)
    expect(store.getFlag('non_live_flag')).toBe('old_value');

    expect(store.getConfigVersion()).toBe(2);
    expect(store.getClientThresholds()).toEqual({
      minimum_version: '1.5.0',
      recommended_version: '1.6.0',
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ notify_me: true, non_live_flag: 'new_value' })
    );

    // Persisted to storage
    expect(storage.getItem(STORAGE_KEY_ETAG)).toBe('"abc123"');
    expect(storage.getItem(STORAGE_KEY_CONFIG)).toContain('"notify_me":true');
  });

  it('sends If-None-Match when etag is in storage and handles 304 without changes', async () => {
    const storage = new MemoryConfigStorage();
    storage.setItem(STORAGE_KEY_ETAG, '"cached-etag"');
    storage.setItem(
      STORAGE_KEY_CONFIG,
      JSON.stringify({
        config_version: 1,
        flags: { notify_me: false },
        client: { minimum_version: null, recommended_version: null },
      })
    );

    let sentIfNoneMatch: string | null = null;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      sentIfNoneMatch = headers.get('if-none-match');
      return new Response(null, { status: 304 });
    });

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
      fetch: mockFetch,
    });

    const updated = await store.fetchInBackground();
    expect(updated).toBe(false);
    expect(sentIfNoneMatch).toBe('"cached-etag"');
    expect(store.isNotifyMe()).toBe(false);
  });

  it('leaves stored config in use and never throws on network failure or server 500', async () => {
    const storage = new MemoryConfigStorage();
    storage.setItem(
      STORAGE_KEY_CONFIG,
      JSON.stringify({
        config_version: 3,
        flags: { notify_me: true },
        client: { minimum_version: '1.0.0', recommended_version: '1.1.0' },
      })
    );

    // Network error
    const networkFailFetch = vi.fn().mockRejectedValue(new Error('Network disconnected'));
    const store1 = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
      fetch: networkFailFetch,
    });

    await expect(store1.fetchInBackground()).resolves.toBe(false);
    expect(store1.isNotifyMe()).toBe(true);

    // HTTP 500 error
    const httpErrorFetch = vi
      .fn()
      .mockResolvedValue(new Response('Internal Server Error', { status: 500 }));
    const store2 = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
      fetch: httpErrorFetch,
    });

    await expect(store2.fetchInBackground()).resolves.toBe(false);
    expect(store2.isNotifyMe()).toBe(true);
  });

  it('handles corrupt stored JSON gracefully', () => {
    const storage = new MemoryConfigStorage();
    storage.setItem(STORAGE_KEY_CONFIG, '{invalid json');

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      storage,
    });

    expect(store.isNotifyMe()).toBe(false);
    expect(store.getConfigVersion()).toBe(1);
  });

  it('deduplicates in-flight background fetches', async () => {
    let resolveFetch: (value: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const mockFetch = vi.fn().mockReturnValue(pendingPromise);

    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      fetch: mockFetch,
    });

    const p1 = store.fetchInBackground();
    const p2 = store.fetchInBackground();
    expect(p1).toBe(p2);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFetch!(
      new Response(
        JSON.stringify({
          config_version: 1,
          flags: {},
          client: { minimum_version: null, recommended_version: null },
        }),
        { status: 200 }
      )
    );
    await expect(p1).resolves.toBe(true);
  });

  it('handles unsubscribe and listener errors without failing store', async () => {
    const store = new RemoteConfigStore({
      baseUrl: 'http://api.example',
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            config_version: 2,
            flags: { notify_me: true },
            client: { minimum_version: null, recommended_version: null },
          }),
          { status: 200 }
        )
      ),
    });

    const brokenListener = vi.fn().mockImplementation(() => {
      throw new Error('Listener exploded');
    });
    const normalListener = vi.fn();

    const unsubBroken = store.subscribe(brokenListener);
    const unsubNormal = store.subscribe(normalListener);

    unsubNormal();

    const ok = await store.fetchInBackground();
    expect(ok).toBe(true);
    expect(brokenListener).toHaveBeenCalled();
    expect(normalListener).not.toHaveBeenCalled();

    unsubBroken();
  });
});
