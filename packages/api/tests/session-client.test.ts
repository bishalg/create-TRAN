// Verifies: REQ-SEC-014 REQ-SEC-016 REQ-SEC-017 REQ-SEC-018 REQ-SEC-022 (the web session client)
import { afterEach, describe, expect, it, vi } from 'vitest';
// The real recovery table, from its TypeScript mirror (`@tran/core` depends on this package).
import { refreshEvent, sessionRecovery } from '../../core-ts/src/session.js';
import { checkVoteEligibility, TranApiError } from '../src/client.js';
import {
  credentialsFor,
  SessionClient,
  type SessionRecoveryAction,
  type SessionRules,
} from '../src/session.js';

const rules: SessionRules = { sessionRecovery, refreshEvent };
const API = 'http://api.test';
const VOTER = { user_id: 'voter-001', role: 'citizen_voter' } as const;

function reply(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'x-request-id': 'req-1' }),
    json: async () => body,
  } as unknown as Response;
}

const expired = () =>
  reply(401, {
    success: false,
    error: 'The session is missing, expired or revoked; sign in again',
    code: 'auth.session_expired',
    request_id: 'req-1',
  });

const issued = (token: string, status = 200) =>
  reply(status, { access_token: token, token_type: 'Bearer', expires_in: 900, user: VOTER });

type Call = { path: string; init: RequestInit };

/**
 * A stand-in for the Axum auth routes: sign-in issues `at-1`, each refresh `at-2`, `at-3`, …;
 * only the newest access token is accepted. `onRefresh` replaces the refresh answer.
 */
function fakeServer(options: { onRefresh?: () => Promise<Response> | Response } = {}) {
  let current: string | null = null;
  let issuedCount = 0;
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const bearer = (init.headers as Record<string, string>).Authorization;
    switch (path) {
      case '/api/auth/session':
        if (init.method === 'POST') {
          current = `at-${++issuedCount}`;
          return issued(current, 201);
        }
        return bearer === `Bearer ${current}` ? reply(200, VOTER) : expired();
      case '/api/auth/refresh':
        if (options.onRefresh) return options.onRefresh();
        current = `at-${++issuedCount}`;
        return issued(current);
      case '/api/auth/sign-out':
        current = null;
        return reply(204);
      default:
        return bearer === `Bearer ${current}` ? reply(200, { ok: true }) : expired();
    }
  });
  const client = new SessionClient({
    baseUrl: `${API}/`,
    fetchFn: fetchFn as unknown as typeof fetch,
    rules,
  });
  const to = (path: string) => calls.filter((call) => call.path === path);
  const bearerOf = (call: Call) => (call.init.headers as Record<string, string>).Authorization;
  return {
    client,
    fetchFn,
    calls,
    to,
    bearerOf,
    /** The server forgets every token, as after a restart or an expiry. */
    expire: () => {
      current = 'nobody';
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in (REQ-SEC-018)', () => {
  it('asks for the cookie transport, with credentials, and keeps the user', async () => {
    const server = fakeServer();
    await expect(server.client.signIn('citizen_voter')).resolves.toEqual(VOTER);
    const [call] = server.to('/api/auth/session');
    expect(call!.init.method).toBe('POST');
    expect(JSON.parse(String(call!.init.body))).toEqual({
      role: 'citizen_voter',
      transport: 'cookie',
    });
    expect(call!.init.credentials).toBe('include');
    expect(call!.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(server.client.user).toEqual(VOTER);
  });

  it('throws the API error when the sign-in is refused', async () => {
    const fetchFn = vi.fn(async () =>
      reply(400, { success: false, error: 'bad role', code: 'validation.malformed_request' })
    );
    const client = new SessionClient({ baseUrl: API, fetchFn: fetchFn as never, rules });
    const error = await client.signIn('citizen_voter').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranApiError);
    expect((error as TranApiError).status).toBe(400);
    expect(client.user).toBeNull();
  });

  it('rejects a malformed answer without repeating it', async () => {
    const fetchFn = vi.fn(async () => reply(201, { access_token: 'leaky-token' }));
    const client = new SessionClient({ baseUrl: API, fetchFn: fetchFn as never, rules });
    const error = (await client.signIn('citizen_voter').catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).not.toContain('leaky-token');
  });
});

describe('credentials travel only to /api/auth (REQ-SEC-018)', () => {
  it('includes them on auth routes and omits them everywhere else', () => {
    expect(credentialsFor('/api/auth/refresh')).toBe('include');
    expect(credentialsFor('/api/auth/sign-out')).toBe('include');
    expect(credentialsFor('/api/vote/eligibility')).toBe('omit');
    expect(credentialsFor('/api/health')).toBe('omit');
    expect(credentialsFor('/api/authority')).toBe('omit');
  });

  it('omits them on an authorized business call and on the eligibility check', async () => {
    const server = fakeServer();
    await server.client.signIn('citizen_voter');
    await server.client.fetch('/api/vote/anything');
    expect(server.to('/api/vote/anything')[0]!.init.credentials).toBe('omit');

    // The fake answers it 401 (no bearer); only the request matters here.
    await checkVoteEligibility(
      { age: 20 },
      { baseUrl: API, fetchFn: server.fetchFn as never }
    ).catch(() => undefined);
    expect(server.to('/api/vote/eligibility')[0]!.init.credentials).toBe('omit');
  });
});

describe('the access token lives in memory only (REQ-SEC-017)', () => {
  it('goes in the Authorization header, never in a URL, and is not enumerable', async () => {
    const server = fakeServer();
    await server.client.signIn('citizen_voter');
    await expect(server.client.whoAmI()).resolves.toEqual(VOTER);
    const [who] = server.to('/api/auth/session').filter((c) => c.init.method === 'GET');
    expect(server.bearerOf(who!)).toBe('Bearer at-1');
    expect(who!.init.credentials).toBe('include');
    for (const call of server.fetchFn.mock.calls) expect(String(call[0])).not.toMatch(/at-\d/);
    expect(JSON.stringify(server.client)).not.toContain('at-1');
    expect(Object.keys(server.client)).toEqual([]);
  });

  it('sends no Authorization header while no token is held', async () => {
    const server = fakeServer();
    await server.client.fetch('/api/vote/anything');
    expect(server.bearerOf(server.calls[0]!)).toBeUndefined();
  });
});

describe('one refresh at a time (REQ-SEC-016)', () => {
  it('sends one refresh for many 401s, and repeats each call once with the new token', async () => {
    const server = fakeServer();
    await server.client.signIn('citizen_voter');
    server.expire();

    const answers = await Promise.all([
      server.client.fetch('/api/vote/a'),
      server.client.fetch('/api/vote/b'),
      server.client.fetch('/api/vote/c'),
    ]);

    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(server.to('/api/auth/refresh')).toHaveLength(1);
    for (const path of ['/api/vote/a', '/api/vote/b', '/api/vote/c']) {
      expect(server.to(path).map(server.bearerOf)).toEqual(['Bearer at-1', 'Bearer at-2']);
    }
    expect(server.to('/api/auth/refresh')[0]!.init.credentials).toBe('include');
  });

  it('starts a new refresh once the previous one has settled', async () => {
    const server = fakeServer();
    await server.client.refresh();
    await server.client.refresh();
    expect(server.to('/api/auth/refresh')).toHaveLength(2);
    expect(server.client.user).toEqual(VOTER);
  });
});

describe('after a 401 the recovery table decides (REQ-SEC-015)', () => {
  it('signs out without a refresh when no session was established', async () => {
    const server = fakeServer();
    const response = await server.client.fetch('/api/vote/a');
    expect(response.status).toBe(401);
    expect(server.to('/api/auth/refresh')).toHaveLength(0);
  });

  it('signs out when the repeated call is refused again', async () => {
    const server = fakeServer({ onRefresh: () => issued('at-unknown') });
    await server.client.signIn('citizen_voter');
    server.expire();
    const response = await server.client.fetch('/api/vote/a');
    expect(response.status).toBe(401);
    expect(server.to('/api/vote/a')).toHaveLength(2);
    expect(server.client.user).toBeNull();
  });

  it('signs out and hands back the 401 when the refresh is rejected', async () => {
    const server = fakeServer({ onRefresh: expired });
    await server.client.signIn('citizen_voter');
    server.expire();
    const response = await server.client.fetch('/api/vote/a');
    expect(response.status).toBe(401);
    expect(server.client.user).toBeNull();
    // The token is gone from memory: the next call carries none.
    await server.client.fetch('/api/vote/b');
    expect(server.bearerOf(server.to('/api/vote/b')[0]!)).toBeUndefined();
  });

  it('keeps the session and rejects with the failure when the refresh got no answer', async () => {
    const offline = new DOMException('fetch failed', 'NetworkError');
    const server = fakeServer({
      onRefresh: () => {
        throw offline;
      },
    });
    await server.client.signIn('citizen_voter');
    server.expire();
    await expect(server.client.fetch('/api/vote/a')).rejects.toBe(offline);
    expect(server.client.user).toEqual(VOTER);
    await server.client.fetch('/api/vote/b').catch(() => undefined);
    expect(server.bearerOf(server.to('/api/vote/b')[0]!)).toBe('Bearer at-1');
  });

  it('keeps the session on a server error, and on a malformed refresh answer', async () => {
    let answer = reply(503, { success: false, error: 'down', code: 'server.unavailable' });
    const server = fakeServer({ onRefresh: () => answer });
    await server.client.signIn('citizen_voter');
    const busy = await server.client.refresh();
    expect(busy).toMatchObject({ kind: 'kept' });
    expect((busy as { error: TranApiError }).error.status).toBe(503);

    answer = reply(200, { access_token: 'leaky-token' });
    const malformed = await server.client.refresh();
    expect(malformed.kind).toBe('kept');
    expect(String((malformed as { error: Error }).error)).not.toContain('leaky-token');
    expect(server.client.user).toEqual(VOTER);
  });

  it('follows the injected table, whatever it says', async () => {
    const keep: SessionRules = {
      sessionRecovery: (): SessionRecoveryAction => 'keep',
      refreshEvent: () => null,
    };
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) throw new Error('offline');
      return expired();
    });
    const client = new SessionClient({ baseUrl: API, fetchFn: fetchFn as never, rules: keep });
    expect((await client.fetch('/api/vote/a')).status).toBe(401);
    expect(await client.refresh()).toMatchObject({ kind: 'kept' });
  });
});

describe('signing out clears the device first (REQ-SEC-022)', () => {
  it('forgets the token before the server call, which carries the cookie', async () => {
    const server = fakeServer();
    await server.client.signIn('citizen_voter');
    let userDuringCall: unknown = 'not called';
    server.fetchFn.mockImplementationOnce(async () => {
      userDuringCall = server.client.user;
      return reply(204);
    });
    await expect(server.client.signOut()).resolves.toBeNull();
    expect(userDuringCall).toBeNull();
    const [call] = server.fetchFn.mock.calls.slice(-1);
    expect(String(call![0])).toBe(`${API}/api/auth/sign-out`);
    expect(call![1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(server.bearerOf({ path: '', init: call![1]! })).toBeUndefined();
  });

  it('stays signed out when the server is unreachable or fails', async () => {
    const server = fakeServer();
    await server.client.signIn('citizen_voter');
    const offline = new DOMException('fetch failed', 'NetworkError');
    server.fetchFn.mockRejectedValueOnce(offline);
    await expect(server.client.signOut()).resolves.toBe(offline);
    expect(server.client.user).toBeNull();

    server.fetchFn.mockResolvedValueOnce(reply(500, { success: false, error: 'boom' }));
    const failed = await server.client.signOut();
    expect((failed as TranApiError).status).toBe(500);
  });

  it('throws away a sign-in that answers after the sign-out, and revokes it', async () => {
    let answer!: (response: Response) => void;
    const server = fakeServer();
    server.fetchFn.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const signingIn = server.client.signIn('citizen_voter');
    await server.client.signOut();
    answer(issued('at-late', 201));

    await expect(signingIn).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.client.user).toBeNull();
    await vi.waitFor(() => expect(server.to('/api/auth/sign-out')).toHaveLength(2));
  });

  it('throws away a refresh that answers after the sign-out, and revokes it', async () => {
    let answer!: (response: Response) => void;
    const server = fakeServer({ onRefresh: () => new Promise((resolve) => (answer = resolve)) });
    const refreshing = server.client.refresh();
    await server.client.signOut();
    answer(issued('at-late'));

    expect(await refreshing).toMatchObject({ kind: 'signed_out' });
    expect(server.client.user).toBeNull();
    await vi.waitFor(() => expect(server.to('/api/auth/sign-out')).toHaveLength(2));
  });
});

describe('errors never carry a token (REQ-SEC-014)', () => {
  it('reads a refused who-am-I as the envelope, without the bearer value', async () => {
    const server = fakeServer({ onRefresh: expired });
    await server.client.signIn('citizen_voter');
    server.expire();
    const error = (await server.client.whoAmI().catch((e: unknown) => e)) as TranApiError;
    expect(error.status).toBe(401);
    expect(error.code).toBe('auth.session_expired');
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(/at-\d/);
  });

  it('rejects a malformed who-am-I answer', async () => {
    const fetchFn = vi.fn(async () => reply(200, { user_id: 'x' }));
    const client = new SessionClient({ baseUrl: API, fetchFn: fetchFn as never, rules });
    await expect(client.whoAmI()).rejects.toBeInstanceOf(TypeError);
  });
});

describe('defaults', () => {
  it('uses http://localhost:3001 and the global fetch', async () => {
    const fetchFn = vi.fn(async () => reply(204));
    vi.stubGlobal('fetch', fetchFn);
    await new SessionClient({ rules }).signOut();
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:3001/api/auth/sign-out',
      expect.objectContaining({ credentials: 'include' })
    );
  });
});
