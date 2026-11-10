// Verifies: REQ-VER-008
/**
 * Responses from the future (`fixtures/compat.json`): a newer server adds fields at every level
 * and enum values this build does not know. Every one must still decode with the web's schemas,
 * and read what the fixture expects: unknown fields dropped, unknown enum values at their
 * declared fallback. iOS and Android decode the same rows (`CompatTests.swift`, `CompatTest.kt`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readApiError } from '../src/client.js';
import { at, schemaFor } from './helpers/routes.js';

interface FutureResponse {
  route: string;
  status: number;
  body: Record<string, unknown>;
  expect: Record<string, unknown>;
}

const { responsesFromTheFuture }: { responsesFromTheFuture: FutureResponse[] } = JSON.parse(
  readFileSync(new URL('../../../fixtures/compat.json', import.meta.url), 'utf8')
);

const routes = responsesFromTheFuture.filter((row) => row.route !== 'error envelope');

describe('responses from the future decode tolerantly (REQ-VER-008)', () => {
  it.each(routes)('[REQ-VER-008] $route', (row) => {
    const decoded = schemaFor(row.route, row.status)!.parse(row.body);
    for (const [path, value] of Object.entries(row.expect))
      expect(at(decoded, path)).toEqual(value);
    // Unknown fields are dropped at every level, never passed on as if this build knew them.
    expect(JSON.stringify(decoded)).not.toMatch(
      /region|memory_bytes|build|total|compulsory|explanation|scope|display_name|rotated_at|team|since/
    );
  });

  it('[REQ-VER-008] covers every route the web reads', () => {
    expect(routes.map((row) => row.route)).toEqual(
      expect.arrayContaining([
        'GET /api/health',
        'GET /api/v1/tran/info',
        'POST /api/v1/vote/eligibility',
        'POST /api/v1/auth/session',
        'POST /api/v1/auth/refresh',
        'GET /api/v1/auth/session',
      ])
    );
  });

  it('[REQ-VER-008] an error envelope from the future keeps its unknown code for the classifier', async () => {
    const row = responsesFromTheFuture.find((r) => r.route === 'error envelope')!;
    const error = await readApiError(
      new Response(JSON.stringify(row.body), { status: row.status })
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('future.code');
    expect(error.requestId).toBe(row.expect.request_id);
  });
});
