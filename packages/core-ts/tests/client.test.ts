import { describe, expect, it, vi } from 'vitest';
import { TranApiClient, TranApiError } from '../src/client.js';
import { classifyError } from '../src/feedback.js';

const validEligibility = {
  eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
  eligible: true,
  age: 21,
  minimum_age: 18,
  country_code: 'US',
  country_source: 'x-debug-country',
  client_ip: '127.0.0.1',
  reason: 'Age 21 meets the minimum voting age of 18 in US.',
  evaluated_at: '2026-10-18T00:00:00Z',
};

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? '',
    json: async () => body,
  };
}

function clientWith(fetchFn: ReturnType<typeof vi.fn>, extra = {}) {
  return new TranApiClient({
    baseUrl: 'http://api.test/',
    fetchFn: fetchFn as unknown as typeof fetch,
    ...extra,
  });
}

describe('TranApiClient transport', () => {
  it('strips trailing slashes from baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ overall_status: 'HEALTHY' }));
    await clientWith(fetchFn, { baseUrl: 'http://api.test//' }).getHealth();
    expect(fetchFn.mock.calls[0][0]).toBe('http://api.test/api/health');
  });

  it('sends default and per-client headers on every request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    await clientWith(fetchFn, { headers: { 'X-Debug-Country': 'NP' } }).getInfo();
    const headers = fetchFn.mock.calls[0][1].headers;
    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Debug-Country': 'NP',
    });
  });

  it('surfaces the server error envelope message', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: false, error: 'Age must be 150 or less' }, { status: 400 })
      );
    await expect(clientWith(fetchFn).getHealth()).rejects.toThrow('Age must be 150 or less');
  });

  it('falls back to the status when the error body is not the envelope', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new SyntaxError('not json');
      },
    });
    await expect(clientWith(fetchFn).getHealth()).rejects.toThrow('HTTP 502');
  });

  // Verifies: REQ-ERR-004
  it('turns its own deadline into a TimeoutError (network.timeout), on every route', async () => {
    const fetchFn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const client = new TranApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 10,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const err = await client.getHealth().catch((e) => e);
    expect(err).toMatchObject({ name: 'TimeoutError', message: 'No response within 10 ms' });
    expect(classifyError(err).code).toBe('network.timeout');
    const eligibility = await client.checkVoteEligibility({ age: 21 }).catch((e) => e);
    expect(classifyError(eligibility).code).toBe('network.timeout');
  });

  it('propagates network failures', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(clientWith(fetchFn).getHealth()).rejects.toThrow('Failed to fetch');
  });
});

describe('TranApiClient.checkVoteEligibility', () => {
  it('posts JSON to the eligibility route with the configured baseUrl and headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(validEligibility));
    await clientWith(fetchFn, { headers: { 'X-Debug-Country': 'US' } }).checkVoteEligibility({
      age: 21,
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://api.test/api/vote/eligibility');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ age: 21 });
    expect(init.headers['X-Debug-Country']).toBe('US');
  });

  it('rejects invalid input before touching the network', async () => {
    const fetchFn = vi.fn();
    await expect(clientWith(fetchFn).checkVoteEligibility({ age: -1 })).rejects.toThrow();
    await expect(clientWith(fetchFn).checkVoteEligibility({ age: 151 })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a response that violates the contract', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...validEligibility, eligible: 'yes' }));
    await expect(clientWith(fetchFn).checkVoteEligibility({ age: 21 })).rejects.toThrow();
  });

  it('turns a 400 envelope into an Error carrying the server message', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: 'Country code must be two ASCII letters' },
          { status: 400 }
        )
      );
    await expect(clientWith(fetchFn).checkVoteEligibility({ age: 21 })).rejects.toThrow(
      'Country code must be two ASCII letters'
    );
  });
});

describe('TranApiError (HTTP failure vs unreachable server)', () => {
  it('is thrown for HTTP failures and carries the status', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, error: 'nope' }, { status: 400 }));
    const err = await clientWith(fetchFn)
      .checkVoteEligibility({ age: 21 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranApiError);
    expect((err as TranApiError).status).toBe(400);
    expect((err as TranApiError).message).toBe('nope');
  });

  it('is also used by generic GET failures', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 503, statusText: 'Down' }));
    const err = await clientWith(fetchFn)
      .getHealth()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranApiError);
    expect((err as TranApiError).status).toBe(503);
  });

  it('is NOT used for network failures, so callers can detect "offline"', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await clientWith(fetchFn)
      .getHealth()
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TranApiError);
  });
});

describe('TranApiClient.withHeaders', () => {
  it('returns a new client that keeps baseUrl, timeout, fetch and existing headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}));
    const base = clientWith(fetchFn, { headers: { 'X-A': '1' } });
    const derived = base.withHeaders({ 'X-B': '2' });

    expect(derived).not.toBe(base);
    await derived.getInfo();
    expect(fetchFn.mock.calls[0][0]).toBe('http://api.test/api/tran/info');
    expect(fetchFn.mock.calls[0][1].headers).toMatchObject({ 'X-A': '1', 'X-B': '2' });

    await base.getInfo();
    expect(fetchFn.mock.calls[1][1].headers).not.toHaveProperty('X-B');
  });
});

describe('TranApiClient defaults', () => {
  it('uses http://localhost:3001 and the global fetch when given no options', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ overall_status: 'HEALTHY' }));
    vi.stubGlobal('fetch', fetchFn);
    await new TranApiClient().getHealth();
    vi.unstubAllGlobals();
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:3001/api/health');
  });
});
