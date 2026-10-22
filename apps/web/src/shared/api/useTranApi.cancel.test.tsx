// Verifies: REQ-LOAD-004 REQ-ROB-006
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TranRequestError } from '@tran/core';
import { describe, expect, it, vi } from 'vitest';
import { useTranApi } from './useTranApi.js';
import type { Feedback } from '../feedback/FeedbackProvider.js';
import { createFakeApi } from '../../../tests/helpers/fakeApi.js';

const instant = { sleep: async () => {}, random: () => 0 };

async function ready() {
  const api = createFakeApi();
  vi.stubGlobal('fetch', api.fetchFn);
  const feedback = {
    acknowledge: vi.fn(),
    confirm: vi.fn(async () => true),
    report: vi.fn((error: TranRequestError) => error.spec.presentation),
  } satisfies Feedback;
  const hook = renderHook(() =>
    useTranApi({ feedback, baseUrl: 'http://api.test', retry: instant })
  );
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return { api, feedback, ...hook };
}

/** Rejects like the browser's fetch once its signal aborts. */
const hangUntilAborted = (_url: string, init?: RequestInit) =>
  new Promise<never>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError'))
    );
  });

describe('useTranApi: cancelCheck (REQ-LOAD-004)', () => {
  it('[REQ-LOAD-004] aborts the check in flight, stops checking and changes nothing else', async () => {
    const { api, feedback, result } = await ready();
    await act(async () => {
      await result.current.checkViaApi(30, 'US');
    });
    const before = result.current.lastApiResult;
    feedback.acknowledge.mockClear();
    api.fetchFn.mockImplementationOnce(hangUntilAborted);

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.checkViaApi(17, 'US');
    });
    expect(result.current.isChecking).toBe(true);
    act(() => result.current.cancelCheck());

    await act(async () => {
      await expect(pending).resolves.toBeNull();
    });
    const [, init] = api.fetchFn.mock.calls.at(-1)!;
    expect(init?.signal?.aborted).toBe(true);
    expect(result.current.isChecking).toBe(false);
    expect(result.current.lastApiResult).toBe(before);
    expect(result.current.fallbackResult).toBeNull();
    expect(result.current.banner).toBeNull();
    expect(feedback.report).not.toHaveBeenCalled();
    expect(feedback.acknowledge).not.toHaveBeenCalled();
    // The catalogue's `silent` entry: logged at debug, never shown.
    expect(console.debug).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ code: 'request.cancelled' })
    );
  });

  it('[REQ-LOAD-004] a cancel after the response arrived but before it was read leaves the screen untouched', async () => {
    const { api, feedback, result } = await ready();
    const healthy = createFakeApi();
    let releaseBody!: () => void;
    const body = new Promise<void>((resolve) => (releaseBody = resolve));
    let arrived!: () => void;
    const responded = new Promise<void>((resolve) => (arrived = resolve));
    api.fetchFn.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      const response = await healthy.fetchFn(url, init);
      arrived();
      return { ...response, json: () => body.then(() => response.json()) };
    });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.checkViaApi(30, 'US');
    });
    await responded;
    act(() => result.current.cancelCheck());
    releaseBody();

    await act(async () => {
      await expect(pending).resolves.toBeNull();
    });
    expect(result.current.lastApiResult).toBeNull();
    expect(result.current.isChecking).toBe(false);
    expect(feedback.acknowledge).not.toHaveBeenCalled();
    expect(console.debug).not.toHaveBeenCalledWith('request failed', expect.anything());
  });

  it('[REQ-LOAD-004] is harmless when nothing is in flight', async () => {
    const { feedback, result } = await ready();

    act(() => result.current.cancelCheck());

    expect(result.current.isChecking).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(feedback.report).not.toHaveBeenCalled();
  });

  it('[REQ-LOAD-004] does not cancel the startup status call', async () => {
    const { api, result } = await ready();
    api.fetchFn.mockImplementation(hangUntilAborted);

    act(() => {
      void result.current.refetch();
    });
    act(() => result.current.cancelCheck());

    expect(result.current.isLoading).toBe(true);
    expect(api.fetchFn.mock.calls.at(-1)![1]?.signal?.aborted).toBe(false);
  });
});
