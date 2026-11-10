import { vi } from 'vitest';
import { evaluateVoteEligibilityOffline, VoteEligibilityValidationError } from '@tran/core';

export const healthReport = {
  report_id: 'r-1',
  timestamp: '2026-10-18T00:00:00Z',
  overall_status: 'HEALTHY',
  components: [
    {
      layer: 'rustcore',
      name: 'Rust Domain Core',
      version: '0.1.0',
      healthy: true,
      uptime_seconds: 1,
    },
    {
      layer: 'axumapi',
      name: 'Axum Microservice',
      version: '0.8.0',
      healthy: true,
      uptime_seconds: 1,
    },
  ],
};

export const stackInfo = {
  stack: 'TRAN',
  description: 'test',
  demo: 'voting-eligibility',
  layers: { T: 'a', R: 'b', A: 'c', N: 'd' },
  version: '0.1.0',
};

export const REQUEST_ID = 'req-test-1';

export function json(body: unknown, status = 200) {
  return {
    ok: status < 300,
    status,
    statusText: String(status),
    headers: new Headers({ 'x-request-id': REQUEST_ID }),
    json: async () => body,
  };
}

/** The API's error envelope (REQ-ERR-002). */
export function envelope(status: number, code: string, retryable = false) {
  return json(
    { success: false, error: `server says ${code}`, code, retryable, request_id: REQUEST_ID },
    status
  );
}

export interface FakeApiOptions {
  /** When true every request rejects like a dead server (TypeError: Failed to fetch). */
  down?: boolean;
  /** The browser still holds a refresh cookie for this role from an earlier visit. */
  cookie?: 'citizen_voter' | 'election_auditor';
}

const USER_IDS = { citizen_voter: 'voter-001', election_auditor: 'auditor-001' } as const;

/**
 * In-memory stand-in for the Axum API. Eligibility answers come from the shared rules, so the
 * fake can never disagree with the offline mirror. Inspect `fetchFn.mock.calls` for traffic.
 */
export function createFakeApi(options: FakeApiOptions = {}) {
  // The auth routes of spec 022 on the cookie transport: the cookie is the role it was issued for.
  let cookie = options.cookie ?? null;
  let accessToken: string | null = null;
  let issuedCount = 0;
  const issue = (role: keyof typeof USER_IDS, status: number) => {
    cookie = role;
    accessToken = `access-token-${++issuedCount}`;
    return json(
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 900,
        user: { user_id: USER_IDS[role], role },
      },
      status
    );
  };

  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (options.down) throw new TypeError('Failed to fetch');
    const path = new URL(url).pathname;
    const bearer = ((init?.headers ?? {}) as Record<string, string>).Authorization;

    if (path === '/api/auth/session' && init?.method === 'POST') {
      return issue(JSON.parse(String(init.body)).role, 201);
    }
    if (path === '/api/auth/session') {
      return cookie && bearer === `Bearer ${accessToken}`
        ? json({ user_id: USER_IDS[cookie], role: cookie })
        : envelope(401, 'auth.session_expired');
    }
    if (path === '/api/auth/refresh') {
      return cookie ? issue(cookie, 200) : envelope(401, 'auth.session_expired');
    }
    if (path === '/api/auth/sign-out') {
      cookie = null;
      accessToken = null;
      return json(null, 204);
    }
    if (path === '/api/account' && init?.method === 'DELETE') {
      // Deletion revokes every session of the user, cookie included (REQ-ACC-001, REQ-ACC-002).
      if (!cookie || bearer !== `Bearer ${accessToken}`)
        return envelope(401, 'auth.session_expired');
      cookie = null;
      accessToken = null;
      return json(null, 204);
    }

    if (path === '/api/health') return json(healthReport);
    if (path === '/api/tran/info') return json(stackInfo);
    if (path === '/api/vote/eligibility') {
      const body = JSON.parse(String(init?.body));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const country = headers['X-Debug-Country'] ?? 'US';
      try {
        const r = evaluateVoteEligibilityOffline({ age: body.age, countryCode: country });
        return json({
          eligibility_id: '550e8400-e29b-41d4-a716-446655440000',
          eligible: r.eligible,
          age: r.age,
          minimum_age: r.minimumAge,
          country_code: r.countryCode,
          country_source: 'x-debug-country',
          client_ip: '127.0.0.1',
          reason: r.reason,
          evaluated_at: '2026-10-18T00:00:00Z',
        });
      } catch (e) {
        return envelope(400, (e as VoteEligibilityValidationError).code);
      }
    }
    return envelope(404, 'route.not_found');
  });

  const callsTo = (path: string) =>
    fetchFn.mock.calls.filter(([url]) => new URL(String(url)).pathname === path);

  return { fetchFn, callsTo };
}

/** The voter session the dashboard tests start on, without a boot refresh. */
export const VOTER_SESSION = {
  status: 'authenticated',
  userId: 'voter-001',
  role: 'citizen_voter',
} as const;
