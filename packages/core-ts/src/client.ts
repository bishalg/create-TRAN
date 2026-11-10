import {
  apiPath,
  checkVoteEligibility,
  HEALTH_PATH,
  readApiError,
  SessionClient,
  TranApiError,
  type VoteEligibilityInput,
  type VoteEligibilityOutput,
} from '@tran/api';
import { clientFetch, type ClientFetchOptions } from './compat.js';
import { RETRY_POLICY } from './generated/feedback.js';
import { refreshEvent, sessionRecovery } from './session.js';
import type { TranHealthReport, TranStackInfo } from './types.js';

export { SessionClient, TranApiError };
export type { RefreshOutcome, SessionUser } from '@tran/api';

/** Per-call options. */
export interface TranCallOptions {
  /** Cancels the call; it then rejects with an `AbortError` (`request.cancelled`, REQ-ROB-006). */
  signal?: AbortSignal;
}

export interface TranApiClientOptions extends ClientFetchOptions {
  /** The API's origin; paths add the versioned base path themselves (REQ-VER-001). */
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
}

/**
 * `fetchFn` with a deadline, so only failures of `fetch` itself leave it as transport errors
 * (REQ-ERR-004, REQ-ROB-002): the deadline → `TimeoutError` (`network.timeout`), the caller's
 * signal → `AbortError` (`request.cancelled`), anything else → `NetworkError`
 * (`network.offline`). A `TypeError` from our own code is therefore never "offline".
 */
export function timedFetch(fetchFn: typeof fetch, timeoutMs: number): typeof fetch {
  return async (url, init) => {
    const controller = new AbortController();
    const caller = init?.signal ?? undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    if (caller?.aborted) cancel();
    caller?.addEventListener('abort', cancel);
    return fetchFn(url, { ...init, signal: controller.signal })
      .catch((err: unknown) => {
        if (timedOut) {
          throw new DOMException(`No response within ${timeoutMs} ms`, 'TimeoutError');
        }
        if (caller?.aborted) throw new DOMException('Cancelled by the caller', 'AbortError');
        throw new DOMException(err instanceof Error ? err.message : 'fetch failed', 'NetworkError');
      })
      .finally(() => {
        clearTimeout(timer);
        caller?.removeEventListener('abort', cancel);
      });
  };
}

/**
 * The web's session client (spec 022): the recovery table of REQ-SEC-015 and the same deadline
 * and error classes as every other call, naming the client on every request (REQ-VER-004). Create
 * one per app, so there is one refresh in flight.
 */
export function createSessionClient(options: Omit<TranApiClientOptions, 'headers'> = {}) {
  return new SessionClient({
    baseUrl: options.baseUrl,
    fetchFn: timedFetch(
      clientFetch(options.fetchFn ?? globalThis.fetch.bind(globalThis), options),
      options.timeoutMs ?? RETRY_POLICY.requestTimeoutMs
    ),
    rules: { sessionRecovery, refreshEvent },
  });
}

export class TranApiClient {
  private readonly options: TranApiClientOptions;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: TranApiClientOptions = {}) {
    this.options = options;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? RETRY_POLICY.requestTimeoutMs;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
    this.fetchWithTimeout = timedFetch(clientFetch(this.fetchFn, options), this.timeoutMs);
  }

  /** New client with the same settings plus extra headers; the original is left untouched. */
  public withHeaders(extra: Record<string, string>): TranApiClient {
    return new TranApiClient({
      ...this.options,
      headers: { ...this.headers, ...extra },
    });
  }

  /** Every call goes through here (see `timedFetch`). */
  private readonly fetchWithTimeout: typeof fetch;

  private async request<T>(path: string, { signal }: TranCallOptions): Promise<T> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.headers,
      },
      // Only the auth tree may carry the session cookie (REQ-SEC-018).
      credentials: 'omit',
      signal,
    });
    if (!response.ok) throw await readApiError(response);
    return (await response.json()) as T;
  }

  public async getHealth(options: TranCallOptions = {}): Promise<TranHealthReport> {
    return this.request<TranHealthReport>(HEALTH_PATH, options);
  }

  public async getInfo(options: TranCallOptions = {}): Promise<TranStackInfo> {
    return this.request<TranStackInfo>(apiPath('/tran/info'), options);
  }

  public async checkVoteEligibility(
    input: VoteEligibilityInput,
    { signal }: TranCallOptions = {}
  ): Promise<VoteEligibilityOutput> {
    return checkVoteEligibility(input, {
      baseUrl: this.baseUrl,
      fetchFn: this.fetchWithTimeout,
      headers: this.headers,
      signal,
    });
  }
}
