// Verifies: REQ-WEB-003 REQ-WEB-006 REQ-ERR-005 REQ-ERR-006 REQ-ERR-008 REQ-ROB-006
import { act, renderHook, waitFor } from '@testing-library/react';
import { TranApiClient, type TranRequestError } from '@tran/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_URL, resolveApiBaseUrl, useTranApi } from './useTranApi.js';
import type { Feedback } from '../feedback/FeedbackProvider.js';
import { createFakeApi, envelope, REQUEST_ID } from '../../../tests/helpers/fakeApi.js';

const BASE = 'http://api.test';
const instant = { sleep: async () => {}, random: () => 0 };

function fakeFeedback() {
  return {
    acknowledge: vi.fn(),
    confirm: vi.fn(async () => true),
    report: vi.fn((error: TranRequestError) => error.spec.presentation),
  } satisfies Feedback;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const api = createFakeApi(opts);
  vi.stubGlobal('fetch', api.fetchFn);
  const feedback = fakeFeedback();
  const hook = renderHook(() => useTranApi({ feedback, baseUrl: BASE, retry: instant }));
  return { api, feedback, ...hook };
}

async function ready(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const ctx = setup(opts);
  await waitFor(() => expect(ctx.result.current.isLoading).toBe(false));
  return ctx;
}

describe('useTranApi: startup', () => {
  it('loads health and info exactly once (no refetch loop)', async () => {
    const { api, result } = await ready();
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

  it('retries an unreachable server, then shows the offline banner without a toast', async () => {
    const { api, feedback, result } = await ready({ down: true });

    expect(api.callsTo('/api/health')).toHaveLength(3);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.banner?.code).toBe('network.offline');
    expect(result.current.health).toBeNull();
    // A background call the user did not start never interrupts them.
    expect(feedback.report).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ code: 'network.offline' })
    );
  });

  it('logs a broken health endpoint without calling the server offline', async () => {
    const api = createFakeApi();
    api.fetchFn.mockResolvedValue(envelope(500, 'server.internal', true));
    vi.stubGlobal('fetch', api.fetchFn);
    const feedback = fakeFeedback();
    const { result } = renderHook(() => useTranApi({ feedback, baseUrl: BASE, retry: instant }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.banner).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ code: 'server.internal', request_id: REQUEST_ID })
    );
  });

  it('refetch recovers after the server comes back', async () => {
    const { api, result } = await ready({ down: true });
    api.fetchFn.mockImplementation(createFakeApi().fetchFn);

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
    const { result } = renderHook(() => useTranApi({ feedback: fakeFeedback(), client }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.callsTo('/api/health')).toHaveLength(1);
  });

  it('falls back to the default URL when no baseUrl/client is given', async () => {
    const api = createFakeApi();
    vi.stubGlobal('fetch', api.fetchFn);
    const { result } = renderHook(() => useTranApi({ feedback: fakeFeedback() }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(String(api.callsTo('/api/health')[0][0])).toBe(`${DEFAULT_API_URL}/api/health`);
  });
});

describe('useTranApi: checkViaApi', () => {
  it('forwards the debug-country header and acknowledges success with a toast', async () => {
    const { api, feedback, result } = await ready();

    await act(async () => {
      await result.current.checkViaApi(16, 'BR', { 'X-Debug-Country': 'BR' });
    });

    const [call] = api.callsTo('/api/vote/eligibility');
    expect(String(call[0])).toBe(`${BASE}/api/vote/eligibility`);
    expect((call[1]?.headers as Record<string, string>)['X-Debug-Country']).toBe('BR');
    expect(result.current.lastApiResult).toMatchObject({ eligible: true, country_code: 'BR' });
    expect(result.current.fallbackResult).toBeNull();
    expect(feedback.acknowledge).toHaveBeenCalledWith('server_check_succeeded');
  });

  it('without headers uses the base client', async () => {
    const { api, result } = await ready();
    await act(async () => {
      await result.current.checkViaApi(30, 'US');
    });
    expect(result.current.lastApiResult?.eligible).toBe(true);
    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(1);
  });

  it('shows a rejected input inline, without retrying, falling back or going offline', async () => {
    const { api, result } = await ready();

    await act(async () => {
      await result.current.checkViaApi(20, 'USA', { 'X-Debug-Country': 'USA' });
    });

    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(1);
    expect(result.current.fieldError?.code).toBe('validation.invalid_country_code');
    expect(result.current.fallbackResult).toBeNull();
    expect(result.current.isOffline).toBe(false);
  });

  it('clears the field error once a check succeeds', async () => {
    const { result } = await ready();
    await act(async () => {
      await result.current.checkViaApi(20, 'USA', { 'X-Debug-Country': 'USA' });
    });
    await act(async () => {
      await result.current.checkViaApi(20, 'US', { 'X-Debug-Country': 'US' });
    });
    expect(result.current.fieldError).toBeNull();
  });

  it('retries a flaky server and succeeds on the next attempt', async () => {
    const { api, feedback, result } = await ready();
    const healthy = createFakeApi();
    api.fetchFn
      .mockResolvedValueOnce(envelope(503, 'server.unavailable', true))
      .mockImplementation(healthy.fetchFn);

    await act(async () => {
      await result.current.checkViaApi(30, 'US');
    });

    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(2);
    expect(result.current.lastApiResult?.eligible).toBe(true);
    expect(feedback.report).not.toHaveBeenCalled();
  });

  it('after the last retry, reports a server error and falls back to the device', async () => {
    const { api, feedback, result } = await ready();
    api.fetchFn.mockResolvedValue(envelope(500, 'server.internal', true));

    await act(async () => {
      await result.current.checkViaApi(17, 'US');
    });

    expect(api.callsTo('/api/vote/eligibility')).toHaveLength(3);
    const [reported] = feedback.report.mock.calls[0];
    expect(reported).toMatchObject({ code: 'server.internal', requestId: REQUEST_ID });
    expect(result.current.fallbackResult).toMatchObject({ eligible: false, minimumAge: 18 });
    expect(result.current.isOffline).toBe(false);
  });

  it('switches to the offline banner and the device verdict when the server dies', async () => {
    const { api, result } = await ready();
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.checkViaApi(20, 'NP');
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.banner?.code).toBe('network.offline');
    expect(result.current.fallbackResult).toMatchObject({ eligible: true, countryCode: 'NP' });
    expect(result.current.isChecking).toBe(false);
  });

  it('shows the device rejection inline when the fallback input is invalid too', async () => {
    const { api, result } = await ready();
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.checkViaApi(20, 'U1');
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.fieldError?.code).toBe('validation.invalid_country_code');
    expect(result.current.fallbackResult).toBeNull();
  });

  it('a later server success replaces the fallback and clears the banner', async () => {
    const { api, result } = await ready();
    api.fetchFn.mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => {
      await result.current.checkViaApi(20, 'NP');
    });

    api.fetchFn.mockImplementation(createFakeApi().fetchFn);
    await act(async () => {
      await result.current.checkViaApi(20, 'NP');
    });

    expect(result.current.fallbackResult).toBeNull();
    expect(result.current.isOffline).toBe(false);
  });

  it('is checking while in flight and not afterwards', async () => {
    const { api, result } = await ready();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const healthy = createFakeApi();
    api.fetchFn.mockImplementation(async (...args: Parameters<typeof healthy.fetchFn>) => {
      await gate;
      return healthy.fetchFn(...args);
    });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.checkViaApi(30, 'US');
    });
    expect(result.current.isChecking).toBe(true);

    release();
    await act(async () => {
      await pending;
    });
    expect(result.current.isChecking).toBe(false);
  });
});

describe('useTranApi: overlapping and abandoned calls (REQ-ROB-006)', () => {
  /** Rejects like the browser's fetch once its signal aborts. */
  const hangUntilAborted = (_url: string, init?: RequestInit) =>
    new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError'))
      );
    });

  it('a newer check cancels the one in flight, and the stale answer never lands', async () => {
    const { api, feedback, result } = await ready();
    const healthy = createFakeApi();
    let releaseFirst!: () => void;
    const firstBody = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstSignal: AbortSignal | undefined;
    api.fetchFn.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      firstSignal = init?.signal ?? undefined;
      const response = await healthy.fetchFn(url, init);
      // The answer arrives, but its body is still streaming when the user asks again.
      return { ...response, json: () => firstBody.then(() => response.json()) };
    });

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.checkViaApi(17, 'US');
    });
    await act(async () => {
      await result.current.checkViaApi(30, 'US');
    });
    releaseFirst();
    await act(async () => {
      await first;
    });

    await expect(first).resolves.toBeNull();
    expect(firstSignal).toBeDefined();
    expect(result.current.lastApiResult?.age).toBe(30);
    expect(result.current.isChecking).toBe(false);
    expect(feedback.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('unmounting cancels a check in flight, which then reports nothing', async () => {
    const { api, feedback, result, unmount } = await ready();
    api.fetchFn.mockImplementationOnce(hangUntilAborted);

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.checkViaApi(30, 'US');
    });
    unmount();

    await expect(pending).resolves.toBeNull();
    const [, init] = api.fetchFn.mock.calls.at(-1)!;
    expect(init?.signal?.aborted).toBe(true);
    expect(feedback.report).not.toHaveBeenCalled();
  });

  it('unmounting during the first load cancels it', async () => {
    const { api, unmount } = setup();
    api.fetchFn.mockImplementation(hangUntilAborted);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.fetchFn.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
  });
});

describe('useTranApi: checkOffline', () => {
  it('evaluates with the shared rules and never touches the network', async () => {
    const { api, result } = await ready();
    const before = api.fetchFn.mock.calls.length;

    act(() => {
      result.current.checkOffline(17, 'US');
    });

    expect(result.current.lastOfflineResult).toMatchObject({ eligible: false, minimumAge: 18 });
    expect(api.fetchFn.mock.calls.length).toBe(before);
  });

  it('reports invalid input inline instead of throwing into React', async () => {
    const { feedback, result } = await ready();

    let returned: unknown = 'unset';
    act(() => {
      returned = result.current.checkOffline(30, 'USA');
    });

    expect(returned).toBeNull();
    expect(result.current.fieldError?.code).toBe('validation.invalid_country_code');
    expect(feedback.report).toHaveBeenCalledOnce();
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
