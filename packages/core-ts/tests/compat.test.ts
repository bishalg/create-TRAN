// Verifies: REQ-VER-001 REQ-VER-004 REQ-VER-005 REQ-VER-006 REQ-VER-008 REQ-VER-010
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  API_BASE_PATH,
  CLIENT_HEADER,
  clientFetch,
  clientStanding,
  compareVersions,
  decodeWireEnum,
  formatClient,
  HEALTH_PATH,
  parseClient,
  RECOMMENDED_VERSION_HEADER,
  standingFromResponse,
  UPDATE_HEADER,
  UPDATE_RECOMMENDED,
  updatePrompt,
  WIRE_ENUMS,
  type ClientPlatform,
  type ClientStanding,
} from '../src/index.js';
import { classifyError } from '../src/feedback.js';
import { TranApiError } from '../src/client.js';

interface CompatFixtures {
  basePath: string;
  healthPath: string;
  headers: Record<string, string>;
  clients: { name: string; header: string | null; platform: string; version: string | null }[];
  formatted: { platform: ClientPlatform; version: string; header: string }[];
  versions: { a: string; b: string; order: -1 | 0 | 1 }[];
  standings: {
    name: string;
    client: string | null;
    minimum: string | null;
    recommended: string | null;
    standing: ClientStanding;
  }[];
  updatePrompts: {
    name: string;
    standing: ClientStanding;
    recommendedVersion: string | null;
    dismissedVersion: string | null;
    show: boolean;
  }[];
  wireEnums: unknown[];
  wireEnumCases: { enum: string; raw: string; decoded: string }[];
  responsesFromTheFuture: {
    route: string;
    status: number;
    body: Record<string, unknown>;
    expect: Record<string, unknown>;
  }[];
}

const fixtures: CompatFixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/compat.json', import.meta.url), 'utf8')
);

describe('compat constants (generated from Rust)', () => {
  it('[REQ-VER-001] the base path, health path and headers match the fixture', () => {
    expect(API_BASE_PATH).toBe(fixtures.basePath);
    expect(HEALTH_PATH).toBe(fixtures.healthPath);
    expect({
      client: CLIENT_HEADER,
      update: UPDATE_HEADER,
      updateRecommended: UPDATE_RECOMMENDED,
      recommendedVersion: RECOMMENDED_VERSION_HEADER,
    }).toEqual(fixtures.headers);
  });

  it('[REQ-VER-008] every wire enum and its fallback match the fixture', () => {
    expect(WIRE_ENUMS).toEqual(fixtures.wireEnums);
  });
});

describe('golden compat fixtures (shared with Rust and native)', () => {
  it.each(fixtures.clients)('[REQ-VER-004] parses $name', (c) => {
    expect(parseClient(c.header)).toEqual({ platform: c.platform, version: c.version });
  });

  it.each(fixtures.formatted)('[REQ-VER-004] formats $header', (c) => {
    expect(formatClient(c.platform, c.version)).toBe(c.header);
    expect(parseClient(c.header)).toEqual({ platform: c.platform, version: c.version });
  });

  it.each(fixtures.versions)('[REQ-VER-005] compares $a with $b', (c) => {
    expect(compareVersions(c.a, c.b)).toBe(c.order);
    expect(compareVersions(c.b, c.a)).toBe(-c.order || 0);
  });

  it.each(fixtures.standings)('[REQ-VER-005] standing: $name', (c) => {
    expect(clientStanding(parseClient(c.client), c.minimum, c.recommended)).toBe(c.standing);
  });

  it.each(fixtures.updatePrompts)('[REQ-VER-010] prompt: $name', (c) => {
    expect(updatePrompt(c)).toBe(c.show);
  });

  it.each(fixtures.wireEnumCases)('[REQ-VER-008] $enum "$raw" decodes to $decoded', (c) => {
    expect(decodeWireEnum(c.enum, c.raw)).toBe(c.decoded);
  });

  it('[REQ-VER-008] an undeclared enum has no fallback', () => {
    expect(decodeWireEnum('verdict_source', 'x')).toBeUndefined();
  });

  it('[REQ-VER-008] an error envelope from the future is classified by its status', () => {
    const row = fixtures.responsesFromTheFuture.find((r) => r.route === 'error envelope')!;
    const body = row.body as { error: string; code: string; request_id: string };
    const error = classifyError(
      new TranApiError(body.error, row.status, { code: body.code, requestId: body.request_id })
    );
    expect({ code: error.code, request_id: error.requestId }).toEqual(row.expect);
  });
});

const response = (status: number, headers: Record<string, string> = {}) =>
  ({ status, ok: status < 300, headers: new Headers(headers) }) as Response;

describe('every answer reports the client standing (REQ-VER-005, REQ-VER-006)', () => {
  it('reads 426 as blocked and the update header as a nudge with its version', () => {
    expect(standingFromResponse(response(426))).toEqual({
      standing: 'upgrade_required',
      recommendedVersion: null,
    });
    expect(
      standingFromResponse(
        response(200, { [UPDATE_HEADER]: 'recommended', [RECOMMENDED_VERSION_HEADER]: '1.5.0' })
      )
    ).toEqual({ standing: 'update_recommended', recommendedVersion: '1.5.0' });
    expect(standingFromResponse(response(200, { [UPDATE_HEADER]: 'recommended' }))).toEqual({
      standing: 'update_recommended',
      recommendedVersion: null,
    });
    expect(standingFromResponse(response(200, { [UPDATE_HEADER]: 'someday' }))).toBeNull();
    expect(standingFromResponse({ status: 200 })).toBeNull();
  });

  it('names the client on every request and passes each standing on', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(426))
      .mockResolvedValueOnce(response(200));
    const onStanding = vi.fn();
    const wrapped = clientFetch(fetchFn as unknown as typeof fetch, {
      client: 'web/1.4.0',
      onStanding,
    });
    const first = await wrapped('http://api.test/x', { headers: { Accept: 'application/json' } });
    await wrapped('http://api.test/y');
    expect(first.status).toBe(426);
    expect(fetchFn.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json',
      [CLIENT_HEADER]: 'web/1.4.0',
    });
    expect(fetchFn.mock.calls[1][1].headers).toEqual({ [CLIENT_HEADER]: 'web/1.4.0' });
    expect(onStanding).toHaveBeenCalledTimes(1);
    expect(onStanding).toHaveBeenCalledWith({
      standing: 'upgrade_required',
      recommendedVersion: null,
    });
  });

  it('without a client or a listener it only passes the request through', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(426));
    const wrapped = clientFetch(fetchFn as unknown as typeof fetch, {});
    await wrapped('http://api.test/x', { method: 'POST' });
    expect(fetchFn.mock.calls[0][1]).toEqual({ method: 'POST', headers: undefined });
  });
});
