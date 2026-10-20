import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyError,
  evaluateVoteEligibilityOffline,
  logFailure,
  type OfflineEligibilityResult,
  type Presentation,
  type RetryOptions,
  TranApiClient,
  type TranHealthReport,
  type TranRequestError,
  type TranStackInfo,
  type VoteEligibilityOutput,
  withRetry,
} from '@tran/core';
import type { Feedback } from '../feedback/FeedbackProvider.js';

export interface UseTranApiState {
  health: TranHealthReport | null;
  info: TranStackInfo | null;
  isLoading: boolean;
  /** True while a server eligibility check (including its retries) is in flight. */
  isChecking: boolean;
  /** A connectivity failure the screen shows as a persistent banner until a call succeeds. */
  banner: TranRequestError | null;
  /** A validation failure the screen shows next to the input (REQ-ERR-006). */
  fieldError: TranRequestError | null;
  lastApiResult: VoteEligibilityOutput | null;
  lastOfflineResult: OfflineEligibilityResult | null;
  /** The device verdict shown in server mode after the server check failed (REQ-ERR-005). */
  fallbackResult: OfflineEligibilityResult | null;
}

export interface UseTranApiOptions {
  feedback: Feedback;
  /** Inject a client in tests. */
  client?: TranApiClient;
  baseUrl?: string;
  /** Inject `sleep`/`random` so tests do not wait for real backoff. */
  retry?: Pick<RetryOptions, 'sleep' | 'random'>;
}

export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/** Pure so it can be unit-tested; the hook passes `import.meta.env`. */
export function resolveApiBaseUrl(env: { VITE_TRAN_API_URL?: string } = {}): string {
  return env.VITE_TRAN_API_URL ? env.VITE_TRAN_API_URL : DEFAULT_API_URL;
}

const defaultApiBase = resolveApiBaseUrl(import.meta.env);

function screenPatch(
  error: TranRequestError,
  presentation: Presentation
): Partial<UseTranApiState> {
  if (presentation.kind === 'banner') return { banner: error };
  if (presentation.kind === 'inline') return { fieldError: error };
  return {};
}

/** The device verdict after a failed server check, or the device's own inline rejection. */
function fallBack(
  age: number,
  countryCode: string,
  fail: (raw: unknown) => Partial<UseTranApiState>
): Partial<UseTranApiState> {
  try {
    return { fallbackResult: evaluateVoteEligibilityOffline({ age, countryCode }) };
  } catch (err) {
    return { ...fail(err), fallbackResult: null };
  }
}

/** Calls that may overlap; in each, only the newest one may change the screen. */
type Slot = 'status' | 'check';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function useTranApi({ feedback, client: injected, baseUrl, retry }: UseTranApiOptions) {
  // Memoised: a client created per render would change `fetchStatus` every render and
  // re-trigger the effect below forever.
  const client = useMemo(
    () => injected ?? new TranApiClient({ baseUrl: baseUrl ?? defaultApiBase }),
    [injected, baseUrl]
  );
  const sleep = retry?.sleep;
  const random = retry?.random;

  const [state, setState] = useState<UseTranApiState>({
    health: null,
    info: null,
    isLoading: true,
    isChecking: false,
    banner: null,
    fieldError: null,
    lastApiResult: null,
    lastOfflineResult: null,
    fallbackResult: null,
  });

  const live = useRef<Partial<Record<Slot, AbortController>>>({});

  /**
   * Runs `task` as the only live call in `slot`: it cancels the previous one, and resolves `null`
   * when this one was superseded or the hook unmounted, so a stale answer — success or failure —
   * never reaches the screen (REQ-ROB-006).
   */
  const latest = useCallback(
    async <T>(
      slot: Slot,
      task: (signal: AbortSignal) => Promise<T>
    ): Promise<Outcome<T> | null> => {
      live.current[slot]?.abort();
      const controller = new AbortController();
      live.current[slot] = controller;
      let outcome: Outcome<T>;
      try {
        outcome = { ok: true, value: await task(controller.signal) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      return controller.signal.aborted ? null : outcome;
    },
    []
  );

  useEffect(() => {
    const calls = live.current;
    return () => Object.values(calls).forEach((controller) => controller.abort());
  }, []);

  /** Logs/toasts through the catalogue; returns the patch for screen-owned presentations. */
  const fail = useCallback(
    (raw: unknown): Partial<UseTranApiState> => {
      const error = classifyError(raw);
      return screenPatch(error, feedback.report(error));
    },
    [feedback]
  );

  const fetchStatus = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    const outcome = await latest('status', (signal) =>
      withRetry(() => Promise.all([client.getHealth({ signal }), client.getInfo({ signal })]), {
        idempotent: true,
        sleep,
        random,
      })
    );
    if (!outcome) return;
    if (outcome.ok) {
      const [health, info] = outcome.value;
      setState((prev) => ({ ...prev, health, info, isLoading: false, banner: null }));
      return;
    }
    // A background call the user did not start: log it and keep any banner, never toast.
    const error = classifyError(outcome.error);
    logFailure(error);
    const banner = error.spec.presentation.kind === 'banner' ? error : null;
    setState((prev) => ({ ...prev, banner, isLoading: false }));
  }, [client, latest, sleep, random]);

  const checkOffline = useCallback(
    (age: number, countryCode: string) => {
      try {
        const result = evaluateVoteEligibilityOffline({ age, countryCode });
        setState((prev) => ({ ...prev, lastOfflineResult: result, fieldError: null }));
        return result;
      } catch (err) {
        const patch = fail(err);
        setState((prev) => ({ ...prev, ...patch, lastOfflineResult: null }));
        return null;
      }
    },
    [fail]
  );

  const checkViaApi = useCallback(
    async (age: number, countryCode: string, headers?: Record<string, string>) => {
      setState((prev) => ({ ...prev, isChecking: true, fieldError: null }));
      const scoped =
        headers && Object.keys(headers).length > 0 ? client.withHeaders(headers) : client;
      const outcome = await latest('check', (signal) =>
        withRetry(() => scoped.checkVoteEligibility({ age }, { signal }), {
          // A pure computation: safe to repeat (REQ-ERR-005).
          idempotent: true,
          sleep,
          random,
        })
      );
      // Superseded by a newer check (which owns `isChecking` now) or unmounted.
      if (!outcome) return null;
      if (outcome.ok) {
        setState((prev) => ({
          ...prev,
          lastApiResult: outcome.value,
          fallbackResult: null,
          isChecking: false,
          banner: null,
        }));
        feedback.acknowledge('server_check_succeeded');
        return outcome.value;
      }
      const patch = fail(outcome.error);
      // Validation is the user's to fix; every other failure falls back to the device rules.
      const fallbackResult = patch.fieldError ? null : fallBack(age, countryCode, fail);
      setState((prev) => ({ ...prev, ...patch, ...fallbackResult, isChecking: false }));
      return null;
    },
    [client, fail, feedback, latest, sleep, random]
  );

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return {
    ...state,
    /** Only an unreachable server is "offline"; a rejection or a 500 means it answered. */
    isOffline: state.banner !== null,
    refetch: fetchStatus,
    checkOffline,
    checkViaApi,
  };
}

export type TranApi = ReturnType<typeof useTranApi>;
