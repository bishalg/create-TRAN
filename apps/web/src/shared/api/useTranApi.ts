import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  evaluateVoteEligibilityOffline,
  isNetworkError,
  type OfflineEligibilityResult,
  TranApiClient,
  type TranHealthReport,
  type TranStackInfo,
  type VoteEligibilityOutput,
} from '@tran/core';

export interface UseTranApiState {
  health: TranHealthReport | null;
  info: TranStackInfo | null;
  isLoading: boolean;
  /** True while a server eligibility check is in flight. */
  isChecking: boolean;
  /** True only when the server could not be reached; a 4xx rejection is NOT "offline". */
  isOffline: boolean;
  error: string | null;
  lastApiResult: VoteEligibilityOutput | null;
  lastOfflineResult: OfflineEligibilityResult | null;
}

export interface UseTranApiOptions {
  /** Inject a client in tests. */
  client?: TranApiClient;
  baseUrl?: string;
}

export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/** Pure so it can be unit-tested; the hook passes `import.meta.env`. */
export function resolveApiBaseUrl(env: { VITE_TRAN_API_URL?: string } = {}): string {
  return env.VITE_TRAN_API_URL ? env.VITE_TRAN_API_URL : DEFAULT_API_URL;
}

const defaultApiBase = resolveApiBaseUrl(import.meta.env);

const messageOf = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export function useTranApi({ client: injected, baseUrl }: UseTranApiOptions = {}) {
  // Memoised: a client created per render would change `fetchStatus` every render and
  // re-trigger the effect below forever.
  const client = useMemo(
    () => injected ?? new TranApiClient({ baseUrl: baseUrl ?? defaultApiBase }),
    [injected, baseUrl]
  );

  const [state, setState] = useState<UseTranApiState>({
    health: null,
    info: null,
    isLoading: true,
    isChecking: false,
    isOffline: false,
    error: null,
    lastApiResult: null,
    lastOfflineResult: null,
  });

  const fetchStatus = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const [health, info] = await Promise.all([client.getHealth(), client.getInfo()]);
      setState((prev) => ({ ...prev, health, info, isLoading: false, isOffline: false }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isOffline: true,
        error: messageOf(err, 'Connection failed'),
      }));
    }
  }, [client]);

  const checkOffline = useCallback((age: number, countryCode: string) => {
    try {
      const result = evaluateVoteEligibilityOffline({ age, countryCode });
      setState((prev) => ({ ...prev, lastOfflineResult: result, error: null }));
      return result;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        lastOfflineResult: null,
        error: messageOf(err, 'Invalid input'),
      }));
      return null;
    }
  }, []);

  const checkViaApi = useCallback(
    async (age: number, headers?: Record<string, string>) => {
      setState((prev) => ({ ...prev, isChecking: true }));
      try {
        const scoped =
          headers && Object.keys(headers).length > 0 ? client.withHeaders(headers) : client;
        const result = await scoped.checkVoteEligibility({ age });
        setState((prev) => ({
          ...prev,
          lastApiResult: result,
          isChecking: false,
          error: null,
          isOffline: false,
        }));
        return result;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isChecking: false,
          error: messageOf(err, 'Eligibility check failed'),
          isOffline: isNetworkError(err) ? true : prev.isOffline,
        }));
        return null;
      }
    },
    [client]
  );

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return {
    ...state,
    refetch: fetchStatus,
    checkOffline,
    checkViaApi,
  };
}

export type TranApi = ReturnType<typeof useTranApi>;
