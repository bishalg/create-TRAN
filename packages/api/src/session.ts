/**
 * The web session client (spec 022, ADR-0039): it holds the access token in memory only, shares
 * one refresh between every caller, repeats a `401` call once after a refresh, and signs out on the
 * device before it tells the server. The refresh token is an `HttpOnly` cookie the browser keeps,
 * so this file never sees it.
 *
 * What to do after a failure is not decided here: the caller injects the Rust recovery table
 * (`sessionRecovery`, `refreshEvent` from `@tran/core`, pinned by `fixtures/session.json`).
 */
import type { ZodType } from 'zod';
import { readApiError } from './client.js';
import { apiPath } from './compat.js';
import {
  formatTraceparent,
  nextSpan,
  parseTraceparent,
  requestSpan,
  startTrace,
  traceparentOf,
  withTraceparent,
} from './trace.js';
import {
  SessionTokenSchema,
  SessionUserSchema,
  type SessionToken,
  type SessionUser,
} from './schemas/session.js';

/** What just went wrong with the session; the same shape as `SessionEvent` in `@tran/core`. */
export type SessionRecoveryEvent =
  | { kind: 'unauthorized'; hasRefreshCredential: boolean; alreadyRetried: boolean }
  | { kind: 'refresh_rejected' }
  | { kind: 'refresh_failed' };

export type SessionRecoveryAction = 'refresh' | 'sign_out' | 'keep';

/** The recovery table of REQ-SEC-015, injected so it stays one Rust decision. */
export interface SessionRules {
  sessionRecovery(event: SessionRecoveryEvent): SessionRecoveryAction;
  refreshEvent(status: number | null): SessionRecoveryEvent | null;
}

/** A refresh rotated the pair, was refused (the session is gone) or got no usable answer. */
export type RefreshOutcome =
  | { kind: 'refreshed'; user: SessionUser }
  | { kind: 'signed_out'; error: unknown }
  | { kind: 'kept'; error: unknown };

export interface SessionClientOptions {
  baseUrl?: string;
  /** The transport; `@tran/core` passes its fetch with the request deadline. */
  fetchFn?: typeof fetch;
  rules: SessionRules;
}

export interface SessionRequest {
  method?: 'GET' | 'POST' | 'DELETE';
  /** JSON text; `Content-Type` is set only when there is a body. */
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  traceId?: string;
}

/** The cookie is scoped to `/api/v1/auth`; no other request may carry credentials (REQ-SEC-018). */
export function credentialsFor(path: string): 'include' | 'omit' {
  return path.startsWith(apiPath('/auth/')) ? 'include' : 'omit';
}

/** A malformed success says nothing useful, and its body is never repeated in an error. */
async function parse<T>(response: Response, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success)
    throw new TypeError(`Unexpected ${response.status} body from the session API`);
  return parsed.data;
}

const cancelled = () =>
  new DOMException('Signed out while the request was in flight', 'AbortError');

const stoppedWaiting = (): RefreshOutcome => ({
  kind: 'kept',
  error: new DOMException('Stopped waiting for the refresh', 'AbortError'),
});

/** `shared`, or `kept` with an `AbortError` as soon as this caller's `signal` fires. */
function waitFor(shared: Promise<RefreshOutcome>, signal: AbortSignal): Promise<RefreshOutcome> {
  return new Promise((resolve) => {
    const stop = () => resolve(stoppedWaiting());
    signal.addEventListener('abort', stop, { once: true });
    void shared.then((outcome) => {
      signal.removeEventListener('abort', stop);
      resolve(outcome);
    });
  });
}

export class SessionClient {
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #rules: SessionRules;
  #accessToken: string | null = null;
  #user: SessionUser | null = null;
  /** The browser holds the cookie: true from a sign-in or refresh until a sign-out. */
  #refreshCredential = false;
  #refreshing: Promise<RefreshOutcome> | null = null;
  #deleting: Promise<void> | null = null;
  /** Bumped by `signOut`, so an answer that lands afterwards is thrown away. */
  #generation = 0;

  constructor(options: SessionClientOptions) {
    this.#baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
    this.#fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.#rules = options.rules;
  }

  /** The signed-in user, or `null`. */
  get user(): SessionUser | null {
    return this.#user;
  }

  /** `POST /api/v1/auth/session` on the cookie transport (REQ-SEC-006, REQ-SEC-018). */
  async signIn(role: SessionUser['role'], { signal }: { signal?: AbortSignal } = {}) {
    const generation = this.#generation;
    const response = await this.#send(apiPath('/auth/session'), {
      method: 'POST',
      body: JSON.stringify({ role, transport: 'cookie' }),
      signal,
    });
    if (!response.ok) throw await readApiError(response);
    const token = await parse(response, SessionTokenSchema);
    if (generation !== this.#generation) {
      void this.#revoke();
      throw cancelled();
    }
    return this.#hold(token);
  }

  /**
   * `POST /api/v1/auth/refresh`, once at a time: every caller while one is in flight gets the same
   * answer (REQ-SEC-016), since two parallel refreshes look like a replay and end the session.
   * If a traceId is supplied (REQ-OBS-010), the refresh call reuses that trace id with a new span id.
   * The shared refresh takes no caller's signal: one caller giving up must not fail it for the
   * others. `signal` only stops this caller waiting (`kept` with an `AbortError`).
   */
  refresh({
    traceId,
    signal,
  }: { traceId?: string; signal?: AbortSignal } = {}): Promise<RefreshOutcome> {
    if (signal?.aborted) return Promise.resolve(stoppedWaiting());
    this.#refreshing ??= this.#rotate(traceId).finally(() => {
      this.#refreshing = null;
    });
    return signal ? waitFor(this.#refreshing, signal) : this.#refreshing;
  }

  /**
   * An authorized call: the bearer token when one is held, and on `401` what the recovery table
   * says: refresh once and repeat, or sign out and hand back the `401`. A refresh that merely
   * failed keeps the session and rejects with its failure. Reuses the user action's trace id
   * across retries and token refresh (REQ-OBS-010).
   */
  async fetch(path: string, request: SessionRequest = {}): Promise<Response> {
    const sampled = parseTraceparent(traceparentOf(request.headers))?.sampled ?? true;
    const { traceId } = requestSpan(request.traceId, request.headers);

    let alreadyRetried = false;
    for (;;) {
      const span = nextSpan(traceId, undefined, sampled);
      const reqWithTrace: SessionRequest = {
        ...request,
        traceId,
        headers: withTraceparent(request.headers, formatTraceparent(span)),
      };
      const response = await this.#send(path, reqWithTrace, this.#accessToken);
      if (response.status !== 401) return response;
      const action = this.#rules.sessionRecovery({
        kind: 'unauthorized',
        hasRefreshCredential: this.#refreshCredential,
        alreadyRetried,
      });
      if (action !== 'refresh') {
        if (action === 'sign_out') this.#clear();
        return response;
      }
      const outcome = await this.refresh({ traceId, signal: request.signal });
      if (outcome.kind === 'kept') throw outcome.error;
      if (outcome.kind === 'signed_out') return response;
      alreadyRetried = true;
    }
  }

  /** `GET /api/v1/auth/session`: who the access token belongs to (REQ-SEC-008). */
  async whoAmI({ signal }: { signal?: AbortSignal } = {}): Promise<SessionUser> {
    const response = await this.fetch(apiPath('/auth/session'), { signal });
    if (!response.ok) throw await readApiError(response);
    return parse(response, SessionUserSchema);
  }

  /**
   * `DELETE /api/v1/account` (REQ-ACC-006, ADR-0041): the server decides, then the device follows.
   * Only a success forgets the session; any failure (offline, timeout, `5xx`) rejects with that
   * failure and leaves the session as it was. A `401` takes the recovery path of every authorized
   * call. It is sent even while no token is held: the server, not the device, says whether there
   * is a session to delete. One at a time: a second deletion would only answer `401`.
   */
  deleteAccount({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
    this.#deleting ??= this.#deleteAccount(signal).finally(() => {
      this.#deleting = null;
    });
    return this.#deleting;
  }

  async #deleteAccount(signal?: AbortSignal): Promise<void> {
    const response = await this.fetch(apiPath('/account'), { method: 'DELETE', signal });
    if (!response.ok) throw await readApiError(response);
    // Like a sign-out: an answer about the old session that lands afterwards is thrown away.
    this.#generation += 1;
    this.#clear();
    // The deletion carried no cookie (REQ-SEC-018), so the browser ignored the header that clears
    // it. The sign-out call carries it and removes it; best effort, the account is gone either way.
    void this.#revoke();
  }

  /**
   * Clears the token in memory first, then asks the server to revoke the session (REQ-SEC-022).
   * Never rejects: resolves `null` when the server confirmed, else the failure, for the log.
   */
  signOut(options?: { traceId?: string }): Promise<unknown> {
    this.#generation += 1;
    this.#clear();
    return this.#revoke(options?.traceId);
  }

  async #rotate(traceId?: string): Promise<RefreshOutcome> {
    const generation = this.#generation;
    let event: SessionRecoveryEvent | null;
    let error: unknown;
    const span = traceId ? nextSpan(traceId) : startTrace();
    const headers = { traceparent: formatTraceparent(span) };
    try {
      const response = await this.#send(apiPath('/auth/refresh'), { method: 'POST', headers });
      event = this.#rules.refreshEvent(response.status);
      if (event === null) {
        const token = await parse(response, SessionTokenSchema);
        if (generation !== this.#generation) {
          void this.#revoke(traceId);
          return { kind: 'signed_out', error: cancelled() };
        }
        return { kind: 'refreshed', user: this.#hold(token) };
      }
      error = await readApiError(response, span.traceId);
    } catch (failure) {
      event = this.#rules.refreshEvent(null);
      error = failure;
    }
    if (event && this.#rules.sessionRecovery(event) === 'sign_out') {
      this.#clear();
      return { kind: 'signed_out', error };
    }
    return { kind: 'kept', error };
  }

  async #revoke(traceId?: string): Promise<unknown> {
    try {
      const span = traceId ? nextSpan(traceId) : startTrace();
      const headers = { traceparent: formatTraceparent(span) };
      const response = await this.#send(apiPath('/auth/sign-out'), { method: 'POST', headers });
      return response.ok ? null : await readApiError(response, span.traceId);
    } catch (error) {
      return error;
    }
  }

  #hold(token: SessionToken): SessionUser {
    this.#accessToken = token.access_token;
    this.#user = token.user;
    this.#refreshCredential = true;
    return token.user;
  }

  #clear(): void {
    this.#accessToken = null;
    this.#user = null;
    this.#refreshCredential = false;
  }

  #send(path: string, request: SessionRequest, token?: string | null): Promise<Response> {
    const traceparent = traceparentOf(request.headers) ?? formatTraceparent(startTrace());
    return this.#fetchFn(`${this.#baseUrl}${path}`, {
      method: request.method ?? 'GET',
      headers: withTraceparent(
        {
          Accept: 'application/json',
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...request.headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        traceparent
      ),
      body: request.body,
      credentials: credentialsFor(path),
      signal: request.signal,
    });
  }
}
