import { useCallback, useEffect, useState } from 'react';
import {
  evaluateVoteEligibilityOffline,
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
  isOffline: boolean;
  error: string | null;
  lastApiResult: VoteEligibilityOutput | null;
  lastOfflineResult: OfflineEligibilityResult | null;
}

const defaultApiBase =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_TRAN_API_URL &&
  String(import.meta.env.VITE_TRAN_API_URL).length > 0
    ? String(import.meta.env.VITE_TRAN_API_URL)
    : 'http://127.0.0.1:3001';

export function useTranApi(
  client: TranApiClient = new TranApiClient({ baseUrl: defaultApiBase })
) {
  const [state, setState] = useState<UseTranApiState>({
    health: null,
    info: null,
    isLoading: true,
    isOffline: false,
    error: null,
    lastApiResult: null,
    lastOfflineResult: null,
  });

  const fetchStatus = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const [health, info] = await Promise.all([client.getHealth(), client.getInfo()]);
      setState((prev) => ({
        ...prev,
        health,
        info,
        isLoading: false,
        isOffline: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isOffline: true,
        error: err instanceof Error ? err.message : 'Connection failed',
      }));
    }
  }, [client]);

  const checkOffline = useCallback((age: number, countryCode: string) => {
    const result = evaluateVoteEligibilityOffline({ age, countryCode });
    setState((prev) => ({ ...prev, lastOfflineResult: result, error: null }));
    return result;
  }, []);

  const checkViaApi = useCallback(
    async (age: number, headers?: Record<string, string>) => {
      try {
        const apiClient =
          headers && Object.keys(headers).length > 0
            ? new TranApiClient({ headers })
            : client;
        const result = await apiClient.checkVoteEligibility({ age });
        setState((prev) => ({ ...prev, lastApiResult: result, error: null, isOffline: false }));
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Eligibility check failed';
        setState((prev) => ({ ...prev, error: errorMsg, isOffline: true }));
        return null;
      }
    },
    [client]
  );

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    ...state,
    refetch: fetchStatus,
    checkOffline,
    checkViaApi,
  };
}
