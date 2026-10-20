import {
  checkVoteEligibility,
  readApiError,
  TranApiError,
  type VoteEligibilityInput,
  type VoteEligibilityOutput,
} from '@tran/api';
import { RETRY_POLICY } from './generated/feedback.js';
import type { TranHealthReport, TranStackInfo } from './types.js';

export { TranApiError };

/** Per-call options. */
export interface TranCallOptions {
  /** Cancels the call; it then rejects with an `AbortError` (`request.cancelled`, REQ-ROB-006). */
  signal?: AbortSignal;
}

export interface TranApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
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
  }

  /** New client with the same settings plus extra headers; the original is left untouched. */
  public withHeaders(extra: Record<string, string>): TranApiClient {
    return new TranApiClient({
      ...this.options,
      headers: { ...this.headers, ...extra },
    });
  }

  /**
   * Every call goes through here, and only failures of `fetch` itself leave it as transport
   * errors (REQ-ERR-004, REQ-ROB-002): our deadline → `TimeoutError` (`network.timeout`), the
   * caller's signal → `AbortError` (`request.cancelled`), anything else → `NetworkError`
   * (`network.offline`). A `TypeError` from our own code is therefore never "offline".
   */
  private readonly fetchWithTimeout = async (
    url: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const controller = new AbortController();
    const caller = init?.signal ?? undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const cancel = () => controller.abort();
    if (caller?.aborted) cancel();
    caller?.addEventListener('abort', cancel);
    return this.fetchFn(url, { ...init, signal: controller.signal })
      .catch((err: unknown) => {
        if (timedOut) {
          throw new DOMException(`No response within ${this.timeoutMs} ms`, 'TimeoutError');
        }
        if (caller?.aborted) throw new DOMException('Cancelled by the caller', 'AbortError');
        throw new DOMException(err instanceof Error ? err.message : 'fetch failed', 'NetworkError');
      })
      .finally(() => {
        clearTimeout(timer);
        caller?.removeEventListener('abort', cancel);
      });
  };

  private async request<T>(path: string, { signal }: TranCallOptions): Promise<T> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.headers,
      },
      signal,
    });
    if (!response.ok) throw await readApiError(response);
    return (await response.json()) as T;
  }

  public async getHealth(options: TranCallOptions = {}): Promise<TranHealthReport> {
    return this.request<TranHealthReport>('/api/health', options);
  }

  public async getInfo(options: TranCallOptions = {}): Promise<TranStackInfo> {
    return this.request<TranStackInfo>('/api/tran/info', options);
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
