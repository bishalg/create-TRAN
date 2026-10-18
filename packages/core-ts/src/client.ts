import {
  checkVoteEligibility,
  type VoteEligibilityInput,
  type VoteEligibilityOutput,
} from '@tran/api';
import type { TranHealthReport, TranStackInfo } from './types.js';

export interface TranApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
}

export class TranApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: TranApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
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
          ...(init?.headers ?? {}),
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
        throw new Error(errMessage);
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
