// Verifies: REQ-ERR-012 REQ-ERR-013 REQ-ERR-014 REQ-ERR-015
/**
 * Toast admission, the recovery schedule and the reporter against `fixtures/feedback.json` — the
 * same rows pin Rust, Swift and Kotlin — plus the mechanics over them.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  logFailure,
  TranRequestError,
  withRetry,
  type FeedbackLogger,
  type LogLevel,
  type ToastTone,
} from '../src/feedback.js';
import {
  admitToast,
  isReportedLogLevel,
  RECOVERY_POLICY,
  recoveryProbeDelayMs,
  setErrorReporter,
  TOAST_POLICY,
  type ToastKey,
} from '../src/resilience.js';

interface Fixtures {
  toastPolicy: { maxVisible: number };
  toastQueue: {
    name: string;
    visible: [string, ToastTone][];
    incoming: [string, ToastTone];
    expected: { refresh: number | null; evictOldest: number };
  }[];
  recoveryPolicy: { firstProbeMs: number; maxProbeMs: number };
  recoveryProbes: { probe: number; expectedMs: number }[];
  reportedLogLevels: LogLevel[];
}

const fixtures: Fixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/feedback.json', import.meta.url), 'utf8')
);

const key = ([messageKey, tone]: [string, ToastTone]): ToastKey => ({ messageKey, tone });

const quietLogger = (): FeedbackLogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

afterEach(() => setErrorReporter(null));

describe('toast pressure (REQ-ERR-012)', () => {
  it('TOAST_POLICY is the fixture', () => {
    expect(TOAST_POLICY).toEqual(fixtures.toastPolicy);
  });

  it.each(fixtures.toastQueue)('$name', ({ visible, incoming, expected }) => {
    const admission = admitToast(visible.map(key), key(incoming));
    expect(admission).toEqual(
      expected.refresh === null
        ? { kind: 'append', evictOldest: expected.evictOldest }
        : { kind: 'refresh', index: expected.refresh }
    );
  });
});

describe('banner recovery schedule (REQ-ERR-013)', () => {
  it('RECOVERY_POLICY is the fixture', () => {
    expect(RECOVERY_POLICY).toEqual(fixtures.recoveryPolicy);
  });

  it.each(fixtures.recoveryProbes)(
    'recoveryProbeDelayMs($probe) = $expectedMs',
    ({ probe, expectedMs }) => {
      expect(recoveryProbeDelayMs(probe)).toBe(expectedMs);
    }
  );

  it('treats NaN as the first probe, like Rust u32', () => {
    expect(recoveryProbeDelayMs(Number.NaN)).toBe(RECOVERY_POLICY.firstProbeMs);
  });
});

describe('reporter (REQ-ERR-014)', () => {
  it('only the fixture levels are reported', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    expect(levels.filter(isReportedLogLevel)).toEqual(fixtures.reportedLogLevels);
  });

  it('sends error-level failures with exactly the log event fields', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    logFailure(new TranRequestError('server.internal', 'db down', 500, 'req-1'), quietLogger());
    expect(reporter).toHaveBeenCalledWith(
      { code: 'server.internal', status: 500, request_id: 'req-1' },
      undefined
    );
  });

  it('attaches the thrown value only for client-side codes', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const bug = new TypeError('x is undefined');
    logFailure(
      new TranRequestError('client.unexpected', bug.message, null, undefined, null, bug),
      quietLogger()
    );
    expect(reporter).toHaveBeenLastCalledWith(
      { code: 'client.unexpected', status: null, request_id: undefined },
      bug
    );
    logFailure(
      new TranRequestError('server.internal', 'boom', 500, undefined, null, new Error('server')),
      quietLogger()
    );
    expect(reporter).toHaveBeenLastCalledWith(
      { code: 'server.internal', status: 500, request_id: undefined },
      undefined
    );
  });

  it('never reports below error level', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    logFailure(new TranRequestError('network.offline', 'down'), quietLogger());
    logFailure(new TranRequestError('validation.invalid_date', 'bad'), quietLogger());
    expect(reporter).not.toHaveBeenCalled();
  });

  it('a reporter that throws does not break logging', () => {
    setErrorReporter(() => {
      throw new Error('sink down');
    });
    const logger = quietLogger();
    expect(() =>
      logFailure(new TranRequestError('server.internal', 'x', 500), logger)
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('cancelling during a retry wait (REQ-ERR-015)', () => {
  it('settles at once as request.cancelled and does not try again', async () => {
    const controller = new AbortController();
    const call = vi.fn().mockRejectedValue(new TranRequestError('server.unavailable', 'x', 503));
    const pending = withRetry(call, {
      idempotent: true,
      signal: controller.signal,
      random: () => 0,
      // A wait that never ends on its own: only the abort can settle it.
      sleep: (_ms, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason))
        ),
    });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'request.cancelled' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('a signal aborted before the wait never sleeps', async () => {
    const controller = new AbortController();
    controller.abort();
    const sleep = vi.fn();
    const call = vi.fn().mockRejectedValue(new TranRequestError('server.unavailable', 'x', 503));
    await expect(
      withRetry(call, { idempotent: true, signal: controller.signal, sleep })
    ).rejects.toMatchObject({ code: 'request.cancelled' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('the real sleep honours the signal', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const call = vi.fn().mockRejectedValue(new TranRequestError('server.unavailable', 'x', 503));
      const pending = withRetry(call, {
        idempotent: true,
        signal: controller.signal,
        random: () => 0,
      });
      const settled = expect(pending).rejects.toMatchObject({ code: 'request.cancelled' });
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      await settled;
      expect(call).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a signal the real sleep still waits and retries', async () => {
    vi.useFakeTimers();
    try {
      const call = vi
        .fn()
        .mockRejectedValueOnce(new TranRequestError('server.unavailable', 'x', 503))
        .mockResolvedValue('ok');
      const pending = withRetry(call, { idempotent: true, random: () => 0 });
      await vi.advanceTimersByTimeAsync(RECOVERY_POLICY.firstProbeMs);
      await expect(pending).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});
