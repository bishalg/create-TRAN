// Verifies: REQ-OBS-010 REQ-OBS-011
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  createSessionClient,
  logFailure,
  parseTraceparent,
  setErrorReporter,
  TranApiClient,
  TranRequestError,
  withRetry,
  type ReportEvent,
} from '../src/index.js';

const noSleep = () => Promise.resolve();
const health = { status: 'ok', service: 'tran-api', version: '0.1.0' };
const verdict = {
  eligibility_id: '11111111-2222-4333-8444-555555555555',
  eligible: true,
  age: 25,
  minimum_age: 18,
  country_code: 'NP',
  country_source: 'ip',
  client_ip: '127.0.0.1',
  reason: 'Eligible',
  evaluated_at: '2026-11-11T00:00:00Z',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake transport that records every `traceparent` and answers from `answers` in turn. */
function transport(answers: (() => Promise<Response>)[]) {
  const sent: string[] = [];
  const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get('traceparent')!);
    return answers.shift()!();
  }) as unknown as typeof fetch;
  return { sent, traces: () => sent.map((tp) => parseTraceparent(tp)!), fetchFn };
}

afterEach(() => setErrorReporter(null));

describe('REQ-OBS-010: one user action is one trace on the web', () => {
  it('a retried check reuses the action trace id with a new span per attempt', async () => {
    const t = transport([
      async () => json({ code: 'server.unavailable', error: 'busy' }, 503),
      async () => json(verdict),
    ]);
    const client = new TranApiClient({ baseUrl: 'http://api.test', fetchFn: t.fetchFn });
    await withRetry(({ traceId }) => client.checkVoteEligibility({ age: 25 }, { traceId }), {
      idempotent: true,
      sleep: noSleep,
      random: () => 0,
    });
    const [first, second] = t.traces();
    expect(first!.traceId).toBe(second!.traceId);
    expect(first!.spanId).not.toBe(second!.spanId);
  });

  it('two calls of one action share the trace; retrying both keeps it', async () => {
    const t = transport([
      async () => json(health),
      async () => json({ code: 'server.unavailable', error: 'busy' }, 503),
      async () => json(health),
      async () => json({ service: 'tran-api' }),
    ]);
    const client = new TranApiClient({ baseUrl: 'http://api.test', fetchFn: t.fetchFn });
    await withRetry(
      ({ traceId }) => Promise.all([client.getHealth({ traceId }), client.getInfo({ traceId })]),
      { idempotent: true, sleep: noSleep, random: () => 0 }
    );
    const traces = t.traces();
    expect(traces).toHaveLength(4);
    expect(new Set(traces.map((x) => x.traceId)).size).toBe(1);
    expect(new Set(traces.map((x) => x.spanId)).size).toBe(4);
  });

  it('separate actions get separate traces, and a given trace id is kept', async () => {
    const t = transport([async () => json(health), async () => json(health)]);
    const client = new TranApiClient({ baseUrl: 'http://api.test', fetchFn: t.fetchFn });
    const run = (traceId?: string) =>
      withRetry(({ traceId: id }) => client.getHealth({ traceId: id }), {
        idempotent: true,
        traceId,
      });
    await run();
    await run('abcdefabcdefabcdefabcdefabcdef01');
    const [a, b] = t.traces();
    expect(a!.traceId).not.toBe(b!.traceId);
    expect(b!.traceId).toBe('abcdefabcdefabcdefabcdefabcdef01');
  });

  it('a caller `Traceparent` header of any case is replaced, not doubled', async () => {
    const t = transport([async () => json(health)]);
    const client = new TranApiClient({
      baseUrl: 'http://api.test',
      fetchFn: t.fetchFn,
    }).withHeaders({ Traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' });
    await client.getHealth();
    expect(t.sent[0]).not.toContain(',');
    expect(t.traces()[0]!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});

describe('REQ-OBS-011: a failure with no response still names its trace', () => {
  it('offline: the classified error, the log event and the report carry the sent trace id', async () => {
    const t = transport([
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]);
    const client = new TranApiClient({ baseUrl: 'http://api.test', fetchFn: t.fetchFn });
    const error: TranRequestError = await withRetry(
      ({ traceId }) => client.getHealth({ traceId }),
      { idempotent: true, sleep: noSleep, random: () => 0 }
    ).catch((e: TranRequestError) => e);
    const sentTrace = t.traces()[0]!.traceId;
    expect(error.code).toBe('network.offline');
    expect(error.status).toBeNull();
    expect(error.traceId).toBe(sentTrace);

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logFailure(error, logger);
    const logged = Object.values(logger).flatMap((fn) => fn.mock.calls);
    expect(logged[0]![1]).toMatchObject({ code: 'network.offline', trace_id: sentTrace });
  });

  it('a session call that got no response classifies with the trace id it sent', async () => {
    const t = transport([() => Promise.reject(new TypeError('Failed to fetch'))]);
    const session = createSessionClient({ baseUrl: 'http://api.test', fetchFn: t.fetchFn });
    const raw = await session.whoAmI().catch((e: unknown) => e);
    const error = classifyError(raw);
    expect(error.code).toBe('network.offline');
    expect(error.traceId).toBe(t.traces()[0]!.traceId);
  });

  it('timeout: the deadline failure carries the action trace id', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')))
      );
    const client = new TranApiClient({ baseUrl: 'http://api.test', fetchFn: hang, timeoutMs: 1 });
    const error: TranRequestError = await withRetry(
      ({ traceId }) => client.getHealth({ traceId }),
      { idempotent: false, traceId: 'abcdefabcdefabcdefabcdefabcdef01' }
    ).catch((e: TranRequestError) => e);
    expect(error.code).toBe('network.timeout');
    expect(error.traceId).toBe('abcdefabcdefabcdefabcdefabcdef01');
  });

  it('a reported client failure carries the action trace id', async () => {
    const reported: ReportEvent[] = [];
    setErrorReporter((event) => reported.push(event));
    const error: TranRequestError = await withRetry(
      () => Promise.reject(new Error('bug in our code')),
      { idempotent: true, traceId: 'abcdefabcdefabcdefabcdefabcdef01' }
    ).catch((e: TranRequestError) => e);
    logFailure(error, { debug() {}, info() {}, warn() {}, error() {} });
    expect(reported).toEqual([
      expect.objectContaining({
        code: 'client.unexpected',
        trace_id: 'abcdefabcdefabcdefabcdefabcdef01',
      }),
    ]);
  });

  it('a cancelled backoff wait carries the action trace id', async () => {
    const controller = new AbortController();
    const error: TranRequestError = await withRetry(
      () => Promise.reject(new DOMException('', 'NetworkError')),
      {
        idempotent: true,
        signal: controller.signal,
        traceId: 'abcdefabcdefabcdefabcdefabcdef01',
        sleep: () => {
          controller.abort();
          return Promise.reject(new Error('aborted'));
        },
      }
    ).catch((e: TranRequestError) => e);
    expect(error.code).toBe('request.cancelled');
    expect(error.traceId).toBe('abcdefabcdefabcdefabcdefabcdef01');
  });
});
