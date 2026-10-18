import { useCallback, useEffect, useState } from 'react';
import {
  type CalculationRequest,
  type CalculationResponse,
  TranApiClient,
  type TranHealthReport,
  type TranStackInfo,
} from '@tran/core';

export interface UseTranApiState {
  health: TranHealthReport | null;
  info: TranStackInfo | null;
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
  lastCalculation: CalculationResponse | null;
}

export function useTranApi(client: TranApiClient = new TranApiClient()) {
  const [state, setState] = useState<UseTranApiState>({
    health: null,
    info: null,
    isLoading: true,
    isOffline: false,
    error: null,
    lastCalculation: null,
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
      // Offline fallback: graceful degradation
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isOffline: true,
        error: err instanceof Error ? err.message : 'Connection failed',
      }));
    }
  }, [client]);

  const executeCompute = useCallback(
    async (req: CalculationRequest): Promise<CalculationResponse | null> => {
      try {
        const result = await client.compute(req);
        setState((prev) => ({ ...prev, lastCalculation: result, error: null }));
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Compute error';
        setState((prev) => ({ ...prev, error: errorMsg }));
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
    executeCompute,
  };
}
