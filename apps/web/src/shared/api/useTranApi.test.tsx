// Verifies: REQ-WEB-003 REQ-WEB-006
import { act, renderHook, waitFor } from '@testing-library/react';
import { TranApiClient } from '@tran/core';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_URL, resolveApiBaseUrl, useTranApi } from './useTranApi.js';
import { createFakeApi } from '../../../tests/helpers/fakeApi.js';

const BASE = 'http://api.test';

function setup(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const api = createFakeApi(opts);
  vi.stubGlobal('fetch', api.fetchFn);
  const hook = renderHook(() => useTranApi({ baseUrl: BASE }));
  return { api, ...hook };
}

describe('useTranApi: startup', () => {
  it('loads health and info exactly once (no refetch loop)', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Give any runaway effect a chance to fire again before asserting.
    await new Promise((r) => setTimeout(r, 50));

    expect(api.callsTo('/api/health')).toHaveLength(1);
    expect(api.callsTo('/api/tran/info')).toHaveLength(1);
    expect(result.current.health?.overall_status).toBe('HEALTHY');
    expect(result.current.isOffline).toBe(false);
  });

  it('starts in the loading state', () => {
    const { result } = setup();
    expect(result.current.isLoading).toBe(true);
  });

  it('flags offline mode when the server is unreachable', async () => {
    const { result } = setup({ down: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isOffline).toBe(true);
    expect(result.current.health).toBeNull();
  });

  it('refetch recovers after the server comes back', async () => {
    const api = createFakeApi({ down: true });
    vi.stubGlobal('fetch', api.fetchFn);
    const { result } = renderHook(() => useTranApi({ baseUrl: BASE }));
    await waitFor(() => expect(result.current.isOffline).toBe(true));

    const healthy = createFakeApi();
    api.fetchFn.mockImplementation(healthy.fetchFn);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isOffline).toBe(false);
    expect(result.current.health?.overall_status).toBe('HEALTHY');
  });

  it('accepts an injected client (dependency injection for tests)', async () => {
    const api = createFakeApi();
    const client = new TranApiClient({
      baseUrl: BASE,
      fetchFn: api.fetchFn as unknown as typeof fetch,
    });
    const { result } = renderHook(() => useTranApi({ client }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.callsTo('/api/health')).toHaveLength(1);
  });
});

describe('useTranApi: checkViaApi', () => {
  it('calls the configured base URL and forwards the debug-country header', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.checkViaApi(16, { 'X-Debug-Country': 'BR' });
    });

    const [call] = api.callsTo('/api/vote/eligibility');
    expect(String(call[0])).toBe(`${BASE}/api/vote/eligibility`);
    expect((call[1]?.headers as Record<string, string>)['X-Debug-Country']).toBe('BR');
    expect(result.current.lastApiResult).toMatchObject({ eligible: true, country_code: 'BR' });
  });

  it('shows the server message for a rejected input WITHOUT switching to offline mode', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.checkViaApi(20, { 'X-Debug-Country': 'USA' });
    });

    expect(result.current.error).toMatch(/country code/i);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.lastApiResult).toBeNull();
  });

  it('switches to offline mode when the server cannot be reached', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.checkViaApi(20);
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.error).toBe('Failed to fetch');
  });

  it('clears a previous error after a successful check', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.checkViaApi(20, { 'X-Debug-Country': 'USA' });
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.checkViaApi(20, { 'X-Debug-Country': 'US' });
    });
    expect(result.current.error).toBeNull();
  });
});

describe('useTranApi: checkOffline', () => {
  it('evaluates with the shared rules and never touches the network', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = api.fetchFn.mock.calls.length;

    act(() => {
      result.current.checkOffline(17, 'US');
    });

    expect(result.current.lastOfflineResult).toMatchObject({ eligible: false, minimumAge: 18 });
    expect(api.fetchFn.mock.calls.length).toBe(before);
  });

  it('reports invalid input as an error instead of throwing into React', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown = 'unset';
    act(() => {
      returned = result.current.checkOffline(30, 'USA');
    });

    expect(returned).toBeNull();
    expect(result.current.error).toMatch(/country code/i);
    expect(result.current.lastOfflineResult).toBeNull();
  });
});

describe('resolveApiBaseUrl', () => {
  it('uses the env value when set and the loopback default otherwise', () => {
    expect(resolveApiBaseUrl({ VITE_TRAN_API_URL: 'https://api.example.com' })).toBe(
      'https://api.example.com'
    );
    expect(resolveApiBaseUrl({ VITE_TRAN_API_URL: '' })).toBe(DEFAULT_API_URL);
    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_URL);
  });
});

describe('useTranApi: defaults and non-Error failures', () => {
  it('falls back to the default URL when no baseUrl/client is given', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const { result } = renderHook(() => useTranApi());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(String(api.callsTo('/api/health')[0][0])).toBe(`${DEFAULT_API_URL}/api/health`);
  });

  it('uses generic messages when something other than an Error is thrown', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const { result } = renderHook(() => useTranApi({ baseUrl: BASE }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    api.fetchFn.mockRejectedValue('boom');
    await act(async () => {
      await result.current.checkViaApi(20);
    });
    expect(result.current.error).toBe('Eligibility check failed');

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe('Connection failed');
  });

  it('checkViaApi without headers uses the base client', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.checkViaApi(30);
    });
    expect(result.current.lastApiResult?.eligible).toBe(true);
    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(1);
  });
});

describe('useTranApi: isChecking', () => {
  it('is true while an API check is in flight and false afterwards (success)', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const healthy = createFakeApi();
    api.fetchFn.mockImplementation(async (...args: Parameters<typeof healthy.fetchFn>) => {
      await gate;
      return healthy.fetchFn(...args);
    });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.checkViaApi(30);
    });
    expect(result.current.isChecking).toBe(true);

    release();
    await act(async () => {
      await pending;
    });
    expect(result.current.isChecking).toBe(false);
  });

  it('is reset after a failed check too', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.checkViaApi(30);
    });
    expect(result.current.isChecking).toBe(false);
  });
});
