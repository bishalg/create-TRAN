import { vi } from 'vitest';
import { evaluateVoteEligibilityOffline } from '@tran/core';

export const healthReport = {
  report_id: 'r-1',
  timestamp: '2026-10-18T00:00:00Z',
  overall_status: 'HEALTHY',
  components: [
    { layer: 'rustcore', name: 'Rust Domain Core', version: '0.1.0', healthy: true, uptime_seconds: 1 },
    { layer: 'axumapi', name: 'Axum Microservice', version: '0.8.0', healthy: true, uptime_seconds: 1 },
  ],
};

export const stackInfo = {
  stack: 'TRAN',
  description: 'test',
  demo: 'voting-eligibility',
  layers: { T: 'a', R: 'b', A: 'c', N: 'd' },
  version: '0.1.0',
};

function json(body: unknown, status = 200) {
  return { ok: status < 300, status, statusText: String(status), json: async () => body };
}

export interface FakeApiOptions {
  /** When true every request rejects like a dead server (TypeError: Failed to fetch). */
  down?: boolean;
}

/**
 * In-memory stand-in for the Axum API. Eligibility answers come from the shared rules, so the
 * fake can never disagree with the offline mirror. Inspect `fetchFn.mock.calls` for traffic.
 */
export function createFakeApi(options: FakeApiOptions = {}) {
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (options.down) throw new TypeError('Failed to fetch');
    const path = new URL(url).pathname;

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
        return json({ success: false, error: (e as Error).message }, 400);
      }
    }
    return json({ success: false, error: 'not found' }, 404);
  });

  const callsTo = (path: string) =>
    fetchFn.mock.calls.filter(([url]) => new URL(String(url)).pathname === path);

  return { fetchFn, callsTo };
}
