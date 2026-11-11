// Verifies: REQ-OBS-010 REQ-SEC-016
import { describe, expect, it } from 'vitest';
import {
  checkVoteEligibility,
  parseTraceparent,
  SessionClient,
  type SessionRules,
} from '../src/index.js';

const ACTION = 'abcdefabcdefabcdefabcdefabcdef01';
const CALLER = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

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

/** Every `traceparent` key the request carried, whatever its case. */
function traceKeys(init?: RequestInit): [string, string][] {
  return Object.entries((init?.headers ?? {}) as Record<string, string>).filter(
    ([key]) => key.toLowerCase() === 'traceparent'
  );
}

const rules: SessionRules = {
  sessionRecovery: (event) => (event.kind === 'unauthorized' ? 'refresh' : 'keep'),
  refreshEvent: (status) => (status === 200 ? null : { kind: 'refresh_failed' }),
};

const token = {
  access_token: 'a',
  token_type: 'Bearer',
  expires_in: 900,
  user: { user_id: 'voter-001', role: 'citizen_voter' },
};

describe('REQ-OBS-010: the action owns the trace id', () => {
  it('checkVoteEligibility sends a new span of the action trace', async () => {
    const seen: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      seen.push(traceKeys(init)[0]![1]);
      return json(verdict);
    };
    await checkVoteEligibility({ age: 25 }, { fetchFn, traceId: ACTION });
    await checkVoteEligibility({ age: 25 }, { fetchFn, traceId: ACTION });
    const [a, b] = seen.map(parseTraceparent);
    expect(a?.traceId).toBe(ACTION);
    expect(b?.traceId).toBe(ACTION);
    expect(a?.spanId).not.toBe(b?.spanId);
  });

  it('a failure without a traceparent answer carries the trace id that was sent', async () => {
    const fetchFn: typeof fetch = async () => json({ error: 'busy' }, 503);
    await expect(
      checkVoteEligibility({ age: 25 }, { fetchFn, traceId: ACTION })
    ).rejects.toMatchObject({ status: 503, traceId: ACTION });
  });
});

describe('REQ-OBS-010: a caller traceparent of any case is sent once', () => {
  it('checkVoteEligibility replaces `Traceparent` instead of adding a second header', async () => {
    let keys: [string, string][] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      keys = traceKeys(init);
      return json(verdict);
    };
    await checkVoteEligibility({ age: 25 }, { fetchFn, headers: { Traceparent: CALLER } });
    expect(keys).toHaveLength(1);
    expect(keys[0]![0]).toBe('traceparent');
    expect(parseTraceparent(keys[0]![1])?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('SessionClient.fetch replaces `TRACEPARENT` instead of adding a second header', async () => {
    let keys: [string, string][] = [];
    const client = new SessionClient({
      fetchFn: async (_url, init) => {
        keys = traceKeys(init);
        return json({ ok: true });
      },
      rules,
    });
    await client.fetch('/api/v1/test', { headers: { TRACEPARENT: CALLER } });
    expect(keys).toHaveLength(1);
    expect(parseTraceparent(keys[0]![1])?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});

describe('REQ-SEC-016: one caller cannot cancel the shared refresh', () => {
  function deferredRefresh() {
    let answer!: () => void;
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchFn: typeof fetch = (url, init) => {
      signals.push(init?.signal);
      if (!String(url).endsWith('/auth/refresh')) return Promise.resolve(json({ ok: true }));
      return new Promise<Response>((resolve) => {
        answer = () => resolve(json(token));
      });
    };
    return { client: new SessionClient({ fetchFn, rules }), signals, answer: () => answer() };
  }

  it('caller A stops waiting on its own signal; caller B still gets the refresh', async () => {
    const { client, signals, answer } = deferredRefresh();
    const a = new AbortController();
    const first = client.refresh({ signal: a.signal });
    const second = client.refresh({ signal: new AbortController().signal });
    a.abort();
    const outcomeA = await first;
    expect(outcomeA.kind).toBe('kept');
    expect((outcomeA as { error: DOMException }).error.name).toBe('AbortError');
    answer();
    expect(await second).toMatchObject({ kind: 'refreshed', user: token.user });
    expect(signals).toEqual([undefined]);
  });

  it('a caller whose signal is already aborted does not start a refresh', async () => {
    const { client, signals } = deferredRefresh();
    const outcome = await client.refresh({ signal: AbortSignal.abort() });
    expect(outcome.kind).toBe('kept');
    expect(signals).toEqual([]);
  });

  it('a caller whose signal never fires gets the shared answer', async () => {
    const { client, answer } = deferredRefresh();
    const waiting = client.refresh({ signal: new AbortController().signal });
    answer();
    expect(await waiting).toMatchObject({ kind: 'refreshed' });
  });
});
