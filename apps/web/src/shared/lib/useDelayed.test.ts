// Verifies: REQ-LOAD-002
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayed } from './useDelayed.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const render = (active: boolean, delayMs = 300) =>
  renderHook(({ on, ms }) => useDelayed(on, ms), { initialProps: { on: active, ms: delayMs } });

describe('useDelayed', () => {
  it('[REQ-LOAD-002] stays false while inactive, however long it waits', () => {
    const { result } = render(false);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(false);
  });

  it('[REQ-LOAD-002] turns true only once active has lasted the whole delay', () => {
    const { result } = render(true);
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('[REQ-LOAD-002] a short activity never turns it on', () => {
    const { result, rerender } = render(true);
    act(() => vi.advanceTimersByTime(200));
    rerender({ on: false, ms: 300 });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(false);
  });

  it('[REQ-LOAD-002] resets at once when the activity ends', () => {
    const { result, rerender } = render(true);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(true);

    rerender({ on: false, ms: 300 });
    expect(result.current).toBe(false);
  });

  it('[REQ-LOAD-002] restarts the full delay for the next activity', () => {
    const { result, rerender } = render(true);
    act(() => vi.advanceTimersByTime(300));
    rerender({ on: false, ms: 300 });
    rerender({ on: true, ms: 300 });
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(true);
  });

  it('[REQ-LOAD-002] clears its timer on unmount', () => {
    const { unmount } = render(true);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
