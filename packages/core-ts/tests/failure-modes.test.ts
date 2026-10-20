// Verifies: REQ-ROB-010
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TranApiClient } from '../src/client.js';
import { classifyError } from '../src/feedback.js';

interface ResponseCase {
  id: string;
  name: string;
  status: number;
  headers?: Record<string, string>;
  body: string;
  expect: { code: string; requestId: string | null; retryAfterMs?: number | null };
}

const fixtures: { responses: ResponseCase[] } = JSON.parse(
  readFileSync(new URL('../../../fixtures/failure-modes.json', import.meta.url), 'utf8')
);

describe('failure modes: every HTTP answer classifies like Swift and Kotlin', () => {
  it.each(fixtures.responses)('$id $name', async (c) => {
    const answer = () =>
      Promise.resolve(
        new Response(c.body === '' ? null : c.body, { status: c.status, headers: c.headers })
      );
    const client = new TranApiClient({ baseUrl: 'http://api.test', fetchFn: answer });

    const error = classifyError(await client.getHealth().catch((e: unknown) => e));

    expect(error.code).toBe(c.expect.code);
    expect(error.status).toBe(c.status);
    expect(error.requestId ?? null).toBe(c.expect.requestId);
    if (c.expect.retryAfterMs !== undefined) expect(error.retryAfterMs).toBe(c.expect.retryAfterMs);
  });
});
