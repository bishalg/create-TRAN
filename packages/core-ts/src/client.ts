import {
  checkVoteEligibility,
  TranApiError,
  type VoteEligibilityInput,
  type VoteEligibilityOutput,
} from '@tran/api';
import type { TranHealthReport, TranStackInfo } from './types.js';

export { TranApiError };

/** True when no HTTP response was received (offline, DNS, CORS, timeout). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
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
    this.timeoutMs = options.timeoutMs ?? 5000;
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

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...this.headers,
        },
      });

      if (!response.ok) {
        let errMessage = `HTTP error ${response.status}: ${response.statusText}`;
        try {
          const errorBody = await response.json();
          if (errorBody && typeof errorBody.error === 'string') {
            errMessage = errorBody.error;
          }
        } catch {
          // Keep standard fallback
        }
        throw new TranApiError(errMessage, response.status);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async getHealth(): Promise<TranHealthReport> {
    return this.request<TranHealthReport>('/api/health');
  }

  public async getInfo(): Promise<TranStackInfo> {
    return this.request<TranStackInfo>('/api/tran/info');
  }

  public async checkVoteEligibility(
    input: VoteEligibilityInput
  ): Promise<VoteEligibilityOutput> {
    return checkVoteEligibility(input, {
      baseUrl: this.baseUrl,
      fetchFn: this.fetchFn,
      headers: this.headers,
    });
  }
}
