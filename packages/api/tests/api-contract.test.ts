import { describe, expect, it, vi } from 'vitest';
import { VoteEligibilityOutputSchema } from '../src/schemas/vote.js';
import {
  checkVoteEligibility,
  createTranOrpcClient,
  readApiError,
  TranApiError,
} from '../src/client.js';

describe('@tran/api vote contract', () => {
  it('validates eligibility responses with Zod', () => {
    const sample = VoteEligibilityOutputSchema.parse({
      eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
      eligible: true,
      age: 21,
      minimum_age: 18,
      country_code: 'US',
      country_source: 'loopback-default',
      client_ip: '127.0.0.1',
      reason: 'Age 21 meets the minimum voting age of 18 in US.',
      evaluated_at: '2026-10-18T00:00:00Z',
    });
    expect(sample.eligible).toBe(true);
  });

  it('checkVoteEligibility posts to Axum route', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
        eligible: false,
        age: 16,
        minimum_age: 18,
        country_code: 'US',
        country_source: 'default',
        client_ip: '8.8.8.8',
        reason: 'Age 16 is below the minimum voting age of 18 in US.',
        evaluated_at: '2026-10-18T00:00:00Z',
      }),
    });

    const result = await checkVoteEligibility(
      { age: 16 },
      { baseUrl: 'http://localhost:3001', fetchFn: mockFetch as unknown as typeof fetch }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/vote/eligibility',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.eligible).toBe(false);
  });
});

describe('@tran/api client edge cases', () => {
  const ok = {
    eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
    eligible: true,
    age: 21,
    minimum_age: 18,
    country_code: 'US',
    country_source: 'default',
    client_ip: '1.1.1.1',
    reason: 'ok',
    evaluated_at: '2026-10-18T00:00:00Z',
  };
  const failing = (status: number, body: () => Promise<unknown>) =>
    vi.fn().mockResolvedValue({ ok: false, status, json: body });

  it('createTranOrpcClient exposes vote.eligibility with the same behaviour', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ok });
    const client = createTranOrpcClient({ baseUrl: 'http://x/', fetchFn: fetchFn as never });
    expect((await client.vote.eligibility({ age: 21 })).eligible).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe('http://x/api/vote/eligibility');
  });

  it('defaults to localhost:3001 and the global fetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ok });
    vi.stubGlobal('fetch', fetchFn);
    await checkVoteEligibility({ age: 21 });
    vi.unstubAllGlobals();
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:3001/api/vote/eligibility');
  });

  it('throws TranApiError carrying status and the server message', async () => {
    const fetchFn = failing(400, async () => ({ success: false, error: 'bad age' }));
    const err = await checkVoteEligibility({ age: 21 }, { fetchFn: fetchFn as never }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(TranApiError);
    expect(err).toMatchObject({ status: 400, message: 'bad age', name: 'TranApiError' });
  });

  it('falls back to "HTTP <status>" when the error body has no message or is not JSON', async () => {
    const noMessage = failing(500, async () => ({}));
    const notJson = failing(502, async () => {
      throw new SyntaxError('x');
    });
    await expect(
      checkVoteEligibility({ age: 21 }, { fetchFn: noMessage as never })
    ).rejects.toThrow('HTTP 500');
    await expect(checkVoteEligibility({ age: 21 }, { fetchFn: notJson as never })).rejects.toThrow(
      'HTTP 502'
    );
  });

  // Verifies: REQ-ERR-002 REQ-ERR-004
  it('reads code, request id and Retry-After from the envelope and headers', async () => {
    const response = {
      status: 429,
      headers: new Headers({ 'x-request-id': 'hdr-1', 'retry-after': '1' }),
      json: async () => ({
        success: false,
        error: 'slow down',
        code: 'server.rate_limited',
        retryable: true,
        request_id: 'body-1',
      }),
    } as unknown as Response;
    const err = await readApiError(response);
    expect(err).toMatchObject({
      status: 429,
      message: 'slow down',
      code: 'server.rate_limited',
      requestId: 'body-1',
      retryAfter: '1',
    });
  });

  it('falls back to the x-request-id header and leaves the code empty for foreign bodies', async () => {
    const response = {
      status: 502,
      headers: new Headers({ 'x-request-id': 'hdr-2' }),
      json: async () => ({ message: 'nginx says no' }),
    } as unknown as Response;
    const err = await readApiError(response);
    expect(err).toMatchObject({ status: 502, message: 'HTTP 502', requestId: 'hdr-2' });
    expect(err.code).toBeUndefined();
    expect(err.retryAfter).toBeUndefined();
  });
});
