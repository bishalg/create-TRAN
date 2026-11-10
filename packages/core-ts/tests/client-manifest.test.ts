// Verifies: REQ-VER-003 REQ-VER-004
/**
 * `fixtures/contract/clients/web/current.json` is what the web client sends and reads, and it
 * cannot drift from the code: every public call of the session client and the API client runs
 * against a fake server that answers with the real contract snapshots, and what it sent (method,
 * path, `X-Tran-Client`, credentials, body) and what its schema requires must equal the manifest.
 * `pnpm release` copies the manifest to `<version>.json`; `client_replay_test.rs` replays both.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HealthReportSchema,
  SessionTokenSchema,
  SessionUserSchema,
  SessionClient,
  StackInfoSchema,
  VoteEligibilityOutputSchema,
} from '@tran/api';
import type { ZodType } from 'zod';
import { createSessionClient, TranApiClient } from '../src/client.js';
import { CLIENT_HEADER } from '../src/compat.js';

const fixture = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/contract/${path}`, import.meta.url), 'utf8'));

interface Entry {
  name: string;
  method: string;
  path: string;
  auth?: 'bearer' | 'cookie';
  headers: Record<string, string>;
  body?: unknown;
  status: number;
  reads: Record<string, string>;
}

const manifest: { platform: string; version: string; requests: Entry[] } = fixture(
  'clients/web/current.json'
);
const snapshots: { route: string; status: number; body: unknown }[] = fixture('v1/responses.json');

/** What the code under test reads each answer with. */
const SCHEMAS: Record<string, ZodType | null> = {
  getHealth: HealthReportSchema,
  getInfo: StackInfoSchema,
  checkVoteEligibility: VoteEligibilityOutputSchema,
  signIn: SessionTokenSchema,
  refresh: SessionTokenSchema,
  whoAmI: SessionUserSchema,
  signOut: null,
  deleteAccount: null,
};

/** Every required field of `schema`, by dotted path (`components[].name`), with its JSON type. */
function requiredFields(schema: ZodType, path = ''): Record<string, string> {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  const join = (key: string) => (path ? `${path}.${key}` : key);
  switch (def.type) {
    case 'object':
      return Object.assign(
        {},
        ...Object.entries(def.shape as Record<string, ZodType>).map(([key, field]) =>
          requiredFields(field, join(key))
        )
      );
    case 'array':
      return requiredFields(def.element as ZodType, `${path}[]`);
    case 'optional':
      return {};
    case 'pipe':
      return requiredFields(def.in as ZodType, path);
    case 'literal':
      return { [path]: typeof (def.values as unknown[])[0] };
    default:
      return { [path]: def.type as string };
  }
}

const reads = (schema: ZodType | null) => (schema ? requiredFields(schema) : {});

interface Sent {
  method: string;
  path: string;
  client: string | undefined;
  credentials: RequestCredentials | undefined;
  bearer: boolean;
  body: unknown;
}

/** The route template a concrete path stands for. */
const template = (path: string) => path.replace(/\/countries\/[A-Z]{2}$/, '/countries/{code}');

/** A fake API answering each route with its first successful contract snapshot. */
function fakeServer(sent: Sent[]): typeof fetch {
  return async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({
      method,
      path,
      client: headers[CLIENT_HEADER],
      credentials: init?.credentials,
      bearer: 'Authorization' in headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const answer = snapshots.find(
      (s) => s.route === `${method} ${template(path)}` && s.status >= 200 && s.status < 300
    )!;
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body), {
      status: answer.status,
    });
  };
}

const VERSION = '9.9.9';

/** Runs every public call once and returns what each sent, by name. */
async function record(): Promise<Map<string, Sent>> {
  const sent: Sent[] = [];
  const options = {
    baseUrl: 'http://api.test',
    fetchFn: fakeServer(sent),
    client: `web/${VERSION}`,
  };
  const api = new TranApiClient(options);
  const session = createSessionClient(options);
  const calls: [string, () => Promise<unknown>][] = [
    ['getHealth', () => api.getHealth()],
    ['getInfo', () => api.getInfo()],
    ['checkVoteEligibility', () => api.checkVoteEligibility({ age: 20 })],
    ['signIn', () => session.signIn('citizen_voter')],
    ['refresh', () => session.refresh()],
    ['whoAmI', () => session.whoAmI()],
    ['signOut', () => session.signOut()],
    ['deleteAccount', async () => (await session.signIn('citizen_voter'), session.deleteAccount())],
  ];
  const byName = new Map<string, Sent>();
  for (const [name, call] of calls) {
    await call();
    byName.set(name, sent.at(name === 'deleteAccount' ? -2 : -1)!);
  }
  return byName;
}

/** Public calls of the two clients; plumbing (`fetch`, `withHeaders`) makes no request of its own. */
const publicCalls = () =>
  [SessionClient.prototype, TranApiClient.prototype]
    .flatMap((proto) => Object.getOwnPropertyNames(proto))
    .filter((name) => !['constructor', 'fetch', 'withHeaders', 'request', 'user'].includes(name))
    .sort();

describe('the web client manifest matches the client code (REQ-VER-003)', () => {
  it('[REQ-VER-003] lists every public call of the web clients, once', () => {
    expect(manifest.platform).toBe('web');
    expect(manifest.requests.map((r) => r.name).sort()).toEqual(publicCalls());
  });

  it('[REQ-VER-003] [REQ-VER-004] each entry is what the call sends and reads', async () => {
    const sent = await record();
    for (const entry of manifest.requests) {
      const actual = sent.get(entry.name)!;
      expect({ name: entry.name, method: actual.method, path: actual.path }).toEqual({
        name: entry.name,
        method: entry.method,
        path: entry.path,
      });
      expect(actual.client, entry.name).toBe(
        entry.headers[CLIENT_HEADER]!.replace('{version}', VERSION)
      );
      // A cookie call carries the browser's credentials; a bearer call the access token.
      if (entry.auth === 'cookie') expect(actual.credentials, entry.name).toBe('include');
      expect(actual.bearer, entry.name).toBe(entry.auth === 'bearer');
      expect(actual.body, entry.name).toEqual(entry.body);
      expect(entry.reads, entry.name).toEqual(reads(SCHEMAS[entry.name]!));
    }
  });
});
