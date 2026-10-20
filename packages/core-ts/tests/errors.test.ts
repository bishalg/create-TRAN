// Verifies: REQ-ERR-004 REQ-ERR-005
import { TranApiError } from '@tran/api';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  logFailure,
  TranRequestError,
  withRetry,
  type FeedbackLogger,
} from '../src/feedback.js';
import { VoteEligibilityValidationError } from '../src/voting.js';

/** What `TranApiClient` rejects with when `fetch` itself fails (REQ-ROB-002). */
const offline = (message = 'Failed to fetch') => new DOMException(message, 'NetworkError');

describe('classifyError (REQ-ERR-004)', () => {
  it('prefers the envelope code, keeps the request id and Retry-After', () => {
    const err = classifyError(
      new TranApiError('slow', 429, {
        code: 'server.rate_limited',
        requestId: 'r-1',
        retryAfter: '1',
      })
    );
    expect(err).toBeInstanceOf(TranRequestError);
    expect(err).toMatchObject({
      code: 'server.rate_limited',
      status: 429,
      requestId: 'r-1',
      retryAfterMs: 1000,
    });
    expect(err.spec.retryable).toBe(true);
  });

  it('falls back to the HTTP status for unknown or missing codes', () => {
    expect(classifyError(new TranApiError('x', 503, { code: 'brand.new' })).code).toBe(
      'server.unavailable'
    );
    expect(classifyError(new TranApiError('x', 418)).code).toBe('request.malformed');
  });

  it('maps transport failures to network and cancellation codes', () => {
    expect(classifyError(offline()).code).toBe('network.offline');
    expect(classifyError(new DOMException('t', 'TimeoutError')).code).toBe('network.timeout');
    expect(classifyError(new DOMException('a', 'AbortError')).code).toBe('request.cancelled');
  });

  it('keeps device validation codes and treats anything else as a client bug', () => {
    const invalid = new VoteEligibilityValidationError('m', 'validation.invalid_country_code');
    expect(classifyError(invalid).code).toBe('validation.invalid_country_code');
    expect(classifyError(new Error('oops')).code).toBe('client.unexpected');
    expect(classifyError('not even an error').code).toBe('client.unexpected');
  });

  it('is idempotent', () => {
    const once = classifyError(new TypeError('x'));
    expect(classifyError(once)).toBe(once);
  });
});

describe('withRetry (REQ-ERR-005)', () => {
  const noSleep = vi.fn(async () => {});

  it('retries retryable failures with the policy delay and returns the eventual result', async () => {
    noSleep.mockClear();
    const call = vi
      .fn()
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(new TranApiError('busy', 503))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    await expect(
      withRetry(call, { idempotent: true, sleep: noSleep, random: () => 0.5, onRetry })
    ).resolves.toBe('ok');

    expect(call).toHaveBeenCalledTimes(3);
    expect(noSleep.mock.calls).toEqual([[150], [300]]);
    expect(onRetry.mock.calls.map(([err, retry]) => [err.code, retry])).toEqual([
      ['network.offline', 1],
      ['server.unavailable', 2],
    ]);
  });

  it('honours Retry-After over the backoff schedule', async () => {
    noSleep.mockClear();
    const call = vi
      .fn()
      .mockRejectedValueOnce(new TranApiError('slow', 429, { retryAfter: '1' }))
      .mockResolvedValue('ok');
    await withRetry(call, { idempotent: true, sleep: noSleep, random: () => 0 });
    expect(noSleep.mock.calls).toEqual([[1000]]);
  });

  it('gives up after maxAttempts and throws the classified error', async () => {
    const call = vi.fn().mockRejectedValue(offline());
    const err = await withRetry(call, { idempotent: true, sleep: noSleep }).catch((e) => e);
    expect(call).toHaveBeenCalledTimes(3);
    expect(err).toMatchObject({ code: 'network.offline' });
  });

  it('never retries non-retryable codes or non-idempotent requests', async () => {
    const rejected = vi
      .fn()
      .mockRejectedValue(new TranApiError('bad', 400, { code: 'validation.invalid_country_code' }));
    await expect(withRetry(rejected, { idempotent: true, sleep: noSleep })).rejects.toMatchObject({
      code: 'validation.invalid_country_code',
    });
    expect(rejected).toHaveBeenCalledTimes(1);

    const unreachable = vi.fn().mockRejectedValue(offline());
    await expect(
      withRetry(unreachable, { idempotent: false, sleep: noSleep })
    ).rejects.toMatchObject({
      code: 'network.offline',
    });
    expect(unreachable).toHaveBeenCalledTimes(1);
  });

  it('uses a real timer and Math.random by default', async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValueOnce(offline('x')).mockResolvedValue('ok');
    const pending = withRetry(call, { idempotent: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(1); // waiting for the backoff, not retrying at once
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe('ok');
    vi.useRealTimers();
  });
});

describe('logFailure (REQ-ERR-003 on the client)', () => {
  it('logs at the catalogue level with code and request id', () => {
    const logger: FeedbackLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logFailure(classifyError(new TranApiError('boom', 500, { requestId: 'r-9' })), logger);
    logFailure(classifyError(offline('x')), logger);
    expect(logger.error).toHaveBeenCalledWith('request failed', {
      code: 'server.internal',
      status: 500,
      request_id: 'r-9',
      detail: 'boom',
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('defaults to the console', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logFailure(classifyError(new DOMException('a', 'AbortError')));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
