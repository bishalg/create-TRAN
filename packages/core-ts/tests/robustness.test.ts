// Verifies: REQ-ROB-002 REQ-ROB-005 REQ-ROB-006 REQ-ROB-007
import { TranApiError } from '@tran/api';
import { describe, expect, it, vi } from 'vitest';
import { TranApiClient } from '../src/client.js';
import {
  classifyError,
  logFailure,
  TranRequestError,
  type ErrorCode,
  type FeedbackLogger,
} from '../src/feedback.js';
import { LOG_EVENT } from '../src/generated/feedback.js';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function clientWith(fetchFn: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return new TranApiClient({ baseUrl: 'http://api.test', fetchFn: fetchFn as typeof fetch });
}

/** A fetch that never settles until its signal aborts. */
const hanging = vi.fn(
  (_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError'))
      );
    })
);

describe('only the transport is the network (REQ-ROB-002)', () => {
  it('classifies a programming error as a client bug, never as offline', () => {
    let bug: unknown;
    try {
      (undefined as unknown as { x: number }).x;
    } catch (err) {
      bug = err;
    }
    expect(bug).toBeInstanceOf(TypeError);
    const error = classifyError(bug);
    expect(error.code).toBe('client.unexpected');
    expect(error.spec.logLevel).toBe('error');
  });

  it('classifies a fetch rejection as offline', async () => {
    const err = await clientWith(() => Promise.reject(new TypeError('Failed to fetch')))
      .getHealth()
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'NetworkError' });
    expect(classifyError(err).code).toBe('network.offline');
  });

  it('still classifies a fetch that rejects with a non-Error as offline', async () => {
    const err = await clientWith(() => Promise.reject('socket hang up'))
      .getHealth()
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'NetworkError', message: 'fetch failed' });
    expect(classifyError(err).code).toBe('network.offline');
  });

  it('classifies an unreadable success body as a client bug', async () => {
    const html = () => Promise.resolve(new Response('<html>', { status: 200 }));
    const err = await clientWith(html)
      .getHealth()
      .catch((e: unknown) => e);
    expect(classifyError(err).code).toBe('client.unexpected');
  });
});

describe('error handling never fails (REQ-ROB-005)', () => {
  const throwingGetter = Object.defineProperty({}, 'name', {
    get() {
      throw new Error('getter exploded');
    },
  });
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();

  it.each([
    ['an object without a prototype', Object.create(null)],
    ['a throwing `name` getter', throwingGetter],
    ['a revoked proxy', revoked],
    ['a symbol', Symbol('s')],
    ['a bigint', 10n],
    ['null', null],
    ['undefined', undefined],
    ['a function', () => 1],
  ])('classifies %s as client.unexpected without throwing', (_label, value) => {
    const error = classifyError(value);
    expect(error).toBeInstanceOf(TranRequestError);
    expect(error.code).toBe('client.unexpected');
    expect(typeof error.message).toBe('string');
  });

  it('says so in the log when even inspecting the value failed', () => {
    expect(classifyError(revoked)).toMatchObject({
      name: 'TranRequestError',
      message: 'unclassifiable failure',
    });
  });

  it('trusts only DOMExceptions from the client as transport failures', () => {
    // A library error that happens to be named like one is still a bug, not a cancellation.
    const lookalike = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(classifyError(lookalike).code).toBe('client.unexpected');
  });

  it('falls back to client.unexpected for a code this build does not know', () => {
    const error = new TranRequestError('made.up' as ErrorCode, 'm');
    expect(error.code).toBe('client.unexpected');
    expect(error.spec.code).toBe('client.unexpected');
  });

  it('drops a request id that is unsafe to log or show', () => {
    const error = classifyError(new TranApiError('x', 500, { requestId: 'evil\nline' }));
    expect(error.requestId).toBeUndefined();
    expect(classifyError(new TranApiError('x', 500, { requestId: 'r-1' })).requestId).toBe('r-1');
  });
});

describe('callers can cancel (REQ-ROB-006)', () => {
  it('reports a caller abort as request.cancelled, on every route', async () => {
    const client = clientWith(hanging);
    for (const call of [
      (signal: AbortSignal) => client.getHealth({ signal }),
      (signal: AbortSignal) => client.getInfo({ signal }),
      (signal: AbortSignal) => client.checkVoteEligibility({ age: 21 }, { signal }),
    ]) {
      const controller = new AbortController();
      const pending = call(controller.signal).catch((e: unknown) => e);
      controller.abort();
      const raw = await pending;
      expect(raw).toMatchObject({ name: 'AbortError', message: 'Cancelled by the caller' });
      const error = classifyError(raw);
      expect(error.code).toBe('request.cancelled');
      expect(error.spec.presentation.kind).toBe('silent');
    }
  });

  it('never starts a request whose signal is already aborted', async () => {
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      init?.signal?.aborted
        ? Promise.reject(new DOMException('aborted', 'AbortError'))
        : Promise.resolve(ok({}))
    );
    const err = await clientWith(fetchFn)
      .getHealth({ signal: AbortSignal.abort() })
      .catch((e: unknown) => e);
    expect(classifyError(err).code).toBe('request.cancelled');
  });

  it('stops listening to the caller once the request settles', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await clientWith(() => Promise.resolve(ok({}))).getHealth({ signal: controller.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('one structured event per failure (REQ-ROB-007)', () => {
  it("logs LOG_EVENT's fields, plus the developer detail", () => {
    const logger: FeedbackLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logFailure(classifyError(new TranApiError('boom', 500, { requestId: 'r-9' })), logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message, fields] = vi.mocked(logger.error).mock.calls[0];
    expect(message).toBe(LOG_EVENT.message);
    expect(Object.keys(fields)).toEqual([...LOG_EVENT.fields, 'detail']);
    expect(fields).toEqual({
      code: 'server.internal',
      status: 500,
      request_id: 'r-9',
      detail: 'boom',
    });
  });
});
