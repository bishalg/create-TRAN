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
  method?: 'GET' | 'POST';
  /** JSON text; `Content-Type` is set only when there is a body. */
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The cookie is scoped to `/api/auth`; no other request may carry credentials (REQ-SEC-018). */
export function credentialsFor(path: string): 'include' | 'omit' {
  return path.startsWith('/api/auth/') ? 'include' : 'omit';
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

export class SessionClient {
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #rules: SessionRules;
  #accessToken: string | null = null;
  #user: SessionUser | null = null;
  /** The browser holds the cookie: true from a sign-in or refresh until a sign-out. */
  #refreshCredential = false;
  #refreshing: Promise<RefreshOutcome> | null = null;
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

  /** `POST /api/auth/session` on the cookie transport (REQ-SEC-006, REQ-SEC-018). */
  async signIn(role: SessionUser['role'], { signal }: { signal?: AbortSignal } = {}) {
    const generation = this.#generation;
    const response = await this.#send('/api/auth/session', {
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
   * `POST /api/auth/refresh`, once at a time: every caller while one is in flight gets the same
   * answer (REQ-SEC-016), since two parallel refreshes look like a replay and end the session.
   */
  refresh(): Promise<RefreshOutcome> {
    this.#refreshing ??= this.#rotate().finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  /**
   * An authorized call: the bearer token when one is held, and on `401` what the recovery table
   * says: refresh once and repeat, or sign out and hand back the `401`. A refresh that merely
   * failed keeps the session and rejects with its failure.
   */
  async fetch(path: string, request: SessionRequest = {}): Promise<Response> {
    let alreadyRetried = false;
    for (;;) {
      const response = await this.#send(path, request, this.#accessToken);
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
      const outcome = await this.refresh();
      if (outcome.kind === 'kept') throw outcome.error;
      if (outcome.kind === 'signed_out') return response;
      alreadyRetried = true;
    }
  }

  /** `GET /api/auth/session`: who the access token belongs to (REQ-SEC-008). */
  async whoAmI({ signal }: { signal?: AbortSignal } = {}): Promise<SessionUser> {
    const response = await this.fetch('/api/auth/session', { signal });
    if (!response.ok) throw await readApiError(response);
    return parse(response, SessionUserSchema);
  }

  /**
   * Clears the token in memory first, then asks the server to revoke the session (REQ-SEC-022).
   * Never rejects: resolves `null` when the server confirmed, else the failure, for the log.
   */
  signOut(): Promise<unknown> {
    this.#generation += 1;
    this.#clear();
    return this.#revoke();
  }

  async #rotate(): Promise<RefreshOutcome> {
    const generation = this.#generation;
    let event: SessionRecoveryEvent | null;
    let error: unknown;
    try {
      const response = await this.#send('/api/auth/refresh', { method: 'POST' });
      event = this.#rules.refreshEvent(response.status);
      if (event === null) {
        const token = await parse(response, SessionTokenSchema);
        if (generation !== this.#generation) {
          void this.#revoke();
          return { kind: 'signed_out', error: cancelled() };
        }
        return { kind: 'refreshed', user: this.#hold(token) };
      }
      error = await readApiError(response);
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

  async #revoke(): Promise<unknown> {
    try {
      const response = await this.#send('/api/auth/sign-out', { method: 'POST' });
      return response.ok ? null : await readApiError(response);
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
    return this.#fetchFn(`${this.#baseUrl}${path}`, {
      method: request.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...request.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: request.body,
      credentials: credentialsFor(path),
      signal: request.signal,
    });
  }
}
