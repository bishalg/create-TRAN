// Verifies: REQ-ERR-013
/** `startRecovery`: probes on the shared schedule, on demand, and stops cleanly. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRecovery } from '../src/recovery.js';
import { recoveryProbeDelayMs } from '../src/resilience.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startRecovery (REQ-ERR-013)', () => {
  it('probes on the doubling schedule until one succeeds, then reports recovery once', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(undefined);
    const onRecovered = vi.fn();
    startRecovery({ probe, onRecovered });

    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(1) - 1);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(2));
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(3));
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onRecovered).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(64) * 2);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('nudge probes at once, then keeps the schedule', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('down'));
    const loop = startRecovery({ probe, onRecovered: vi.fn() });
    loop.nudge();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(2));
    expect(probe).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('a nudge while a probe is in flight does not start a second one', async () => {
    let finish: (() => void) | undefined;
    const probe = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onRecovered = vi.fn();
    const loop = startRecovery({ probe, onRecovered });
    loop.nudge();
    loop.nudge();
    expect(probe).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(onRecovered).toHaveBeenCalledOnce();
    loop.nudge();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('stop cancels the timer and aborts a probe in flight without reporting recovery', async () => {
    let seen: AbortSignal | undefined;
    let finish: (() => void) | undefined;
    const probe = vi.fn((signal: AbortSignal) => {
      seen = signal;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const onRecovered = vi.fn();
    const loop = startRecovery({ probe, onRecovered });
    loop.nudge();
    loop.stop();
    expect(seen?.aborted).toBe(true);
    finish?.();
    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(64) * 2);
    expect(onRecovered).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('a probe failing after stop schedules nothing', async () => {
    let fail: ((e: Error) => void) | undefined;
    const probe = vi.fn(() => new Promise<void>((_r, reject) => (fail = reject)));
    const loop = startRecovery({ probe, onRecovered: vi.fn() });
    loop.nudge();
    loop.stop();
    fail?.(new Error('down'));
    await vi.advanceTimersByTimeAsync(recoveryProbeDelayMs(64) * 2);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
