import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_URL, resolveApiBaseUrl, useTranApi } from '../src/hooks/useTranApi.js';
import { createFakeApi } from './helpers/fakeApi.js';

const BASE = 'http://api.test';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const api = createFakeApi(opts);
  vi.stubGlobal('fetch', api.fetchFn);
  return { api, ...renderHook(() => useTranApi({ baseUrl: BASE })) };
}

describe('native useTranApi', () => {
  it('loads status once and stays stable', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.callsTo('/api/health')).toHaveLength(1);
    expect(result.current.isOffline).toBe(false);
  });

  it('goes offline when the server is unreachable', async () => {
    const { result } = setup({ down: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isOffline).toBe(true);
  });

  it('keeps the configured base URL when a debug-country header is sent', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.checkViaApi(16, { 'X-Debug-Country': 'BR' });
    });

    const [call] = api.callsTo('/api/vote/eligibility');
    expect(String(call[0])).toBe(`${BASE}/api/vote/eligibility`);
    expect(result.current.lastApiResult).toMatchObject({ eligible: true, country_code: 'BR' });
  });

  it('treats a 400 as an error message, not as offline', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.checkViaApi(20, { 'X-Debug-Country': 'USA' });
    });

    expect(result.current.error).toMatch(/country code/i);
    expect(result.current.isOffline).toBe(false);
  });

  it('goes offline when an eligibility call cannot reach the server', async () => {
    const { api, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.checkViaApi(20);
    });

    expect(result.current.isOffline).toBe(true);
  });

  it('returns null and sets an error for invalid offline input', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let returned: unknown = 'unset';
    act(() => {
      returned = result.current.checkOffline(30, 'USA');
    });

    expect(returned).toBeNull();
    expect(result.current.error).toMatch(/country code/i);
  });

  it('uses the default URL, generic messages and the base client when nothing is configured', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const { result } = renderHook(() => useTranApi());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(String(api.callsTo('/api/health')[0][0])).toBe(`${DEFAULT_API_URL}/api/health`);

    await act(async () => {
      await result.current.checkViaApi(30); // no headers -> base client
    });
    expect(result.current.lastApiResult?.eligible).toBe(true);

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
});

describe('native resolveApiBaseUrl', () => {
  it('uses the env value when set and the loopback default otherwise', () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_TRAN_API_URL: 'https://x.test' })).toBe(
      'https://x.test'
    );
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_TRAN_API_URL: '' })).toBe(DEFAULT_API_URL);
    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_URL);
  });
});
