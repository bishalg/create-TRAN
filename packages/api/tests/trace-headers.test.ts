// Verifies: REQ-OBS-010
import { describe, expect, it } from 'vitest';
import {
  checkVoteEligibility,
  formatTraceparent,
  parseTraceparent,
  SessionClient,
  type SessionRecoveryEvent,
} from '../src/index.js';

describe('REQ-OBS-010: Every API call carries a trace', () => {
  it('checkVoteEligibility sends a valid traceparent header', async () => {
    let capturedTraceparent: string | null = null;
    const fetchFn: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      capturedTraceparent = headers.get('traceparent');
      return new Response(
        JSON.stringify({
          eligibility_id: '11111111-2222-4333-8444-555555555555',
          eligible: true,
          age: 25,
          minimum_age: 18,
          country_code: 'NP',
          country_source: 'ip',
          client_ip: '127.0.0.1',
          reason: 'Eligible',
          evaluated_at: '2026-11-11T00:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const result = await checkVoteEligibility(
      { age: 25, countryCode: 'NP' },
      { fetchFn, baseUrl: 'http://api.test' }
    );
    expect(result.eligible).toBe(true);
    expect(capturedTraceparent).not.toBeNull();
    const parsed = parseTraceparent(capturedTraceparent);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toHaveLength(32);
    expect(parsed?.spanId).toHaveLength(16);
  });

  it('SessionClient sends traceparent on every request and reuses trace_id across refresh and retried call', async () => {
    const traces: { url: string; traceparent: string }[] = [];
    let callCount = 0;

    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const tp = headers.get('traceparent');
      if (tp) {
        traces.push({ url, traceparent: tp });
      }

      if (url.endsWith('/vote/countries')) {
        callCount++;
        if (callCount === 1) {
          // First attempt fails with 401
          return new Response(
            JSON.stringify({
              success: false,
              code: 'auth.unauthorized',
              error: 'Unauthorized',
            }),
            { status: 401, headers: { 'content-type': 'application/json' } }
          );
        }
        // Second attempt succeeds
        return new Response(JSON.stringify([{ code: 'NP', name: 'Nepal' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/auth/refresh')) {
        return new Response(
          JSON.stringify({
            access_token: 'new-access-token',
            token_type: 'Bearer',
            expires_in: 900,
            user: { user_id: 'user-1', role: 'voter' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(null, { status: 404 });
    };

    const rules = {
      sessionRecovery: (event: SessionRecoveryEvent) => {
        if (event.kind === 'unauthorized') return 'refresh' as const;
        return 'keep' as const;
      },
      refreshEvent: (status: number | null) =>
        status === 200 ? null : { kind: 'refresh_failed' as const },
    };

    const client = new SessionClient({
      baseUrl: 'http://api.test',
      fetchFn,
      rules,
    });

    const response = await client.fetch('/api/v1/vote/countries');
    expect(response.status).toBe(200);

    // Expect 3 calls:
    // 1. /api/v1/vote/countries (401)
    // 2. /api/v1/auth/refresh (200)
    // 3. /api/v1/vote/countries (200)
    expect(traces).toHaveLength(3);
    expect(traces[0]!.url).toContain('/vote/countries');
    expect(traces[1]!.url).toContain('/auth/refresh');
    expect(traces[2]!.url).toContain('/vote/countries');

    const trace1 = parseTraceparent(traces[0]!.traceparent);
    const trace2 = parseTraceparent(traces[1]!.traceparent);
    const trace3 = parseTraceparent(traces[2]!.traceparent);

    expect(trace1).not.toBeNull();
    expect(trace2).not.toBeNull();
    expect(trace3).not.toBeNull();

    // REQ-OBS-010: One user action is one trace: its retries and a token refresh made on its behalf
    // MUST reuse the trace id with a new span id each.
    expect(trace1!.traceId).toBe(trace2!.traceId);
    expect(trace1!.traceId).toBe(trace3!.traceId);

    // Span IDs must all be distinct
    expect(trace1!.spanId).not.toBe(trace2!.spanId);
    expect(trace2!.spanId).not.toBe(trace3!.spanId);
    expect(trace1!.spanId).not.toBe(trace3!.spanId);
  });

  it('handles parseTraceparent and formatTraceparent edge cases and flags', () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('invalid-length')).toBeNull();
    expect(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e473z-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-001')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902bz-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0z')).toBeNull();
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull();

    const unsampled = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00');
    expect(unsampled).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: false,
    });

    const sampled = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(sampled).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    });

    const formattedUnsampled = formatTraceparent({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: false,
    });
    expect(formattedUnsampled).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00');
  });

  it('checkVoteEligibility propagates incoming traceparent and extracts traceId on error', async () => {
    let capturedTp: string | null = null;
    const parentTrace = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const fetchFn: typeof fetch = async (_url, init) => {
      const headers = new Headers(init?.headers);
      capturedTp = headers.get('traceparent');
      return new Response(
        JSON.stringify({
          success: false,
          code: 'request.malformed',
          error: 'Invalid age',
        }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-11f067aa0ba902b7-01',
          },
        }
      );
    };

    await expect(
      checkVoteEligibility(
        { age: 10, countryCode: 'NP' },
        {
          fetchFn,
          baseUrl: 'http://api.test',
          headers: { traceparent: parentTrace },
        }
      )
    ).rejects.toMatchObject({
      code: 'request.malformed',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });

    const parsed = parseTraceparent(capturedTp);
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.spanId).not.toBe('00f067aa0ba902b7');
  });

  it('SessionClient honors incoming traceparent in fetch options and passes traceId to sign-out', async () => {
    let signOutTp: string | null = null;
    const fetchFn: typeof fetch = async (url, init) => {
      const u = String(url);
      const headers = new Headers(init?.headers);
      if (u.endsWith('/auth/sign-out')) {
        signOutTp = headers.get('traceparent');
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const client = new SessionClient({
      baseUrl: 'http://api.test',
      fetchFn,
      rules: {
        sessionRecovery: () => 'keep',
        refreshEvent: () => null,
      },
    });

    const parentTrace = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00';
    await client.fetch('/api/v1/test', {
      headers: { traceparent: parentTrace },
    });

    let fetchWithTraceIdTp: string | null = null;
    const client2 = new SessionClient({
      baseUrl: 'http://api.test',
      fetchFn: async (_url, init) => {
        fetchWithTraceIdTp = new Headers(init?.headers).get('traceparent');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      rules: {
        sessionRecovery: () => 'keep',
        refreshEvent: () => null,
      },
    });
    await client2.fetch('/api/v1/test', {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(fetchWithTraceIdTp).not.toBeNull();
    const parsedFetch = parseTraceparent(fetchWithTraceIdTp);
    expect(parsedFetch?.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    await client.signOut({ traceId: 'cccccccccccccccccccccccccccccccc' });
    expect(signOutTp).not.toBeNull();
    const parsedSignOut = parseTraceparent(signOutTp);
    expect(parsedSignOut).not.toBeNull();
    expect(parsedSignOut?.traceId).toBe('cccccccccccccccccccccccccccccccc');
  });
});
