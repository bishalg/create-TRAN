/**
 * Error classification, retry and logging over the generated catalogue (ADR-0028, spec 011).
 * The policy (codes, presentations, timings) lives in Rust and arrives via `./generated/feedback.ts`;
 * these functions are the mechanics, pinned by `fixtures/feedback.json`.
 */

import { TranApiError } from '@tran/api';
import {
  ACTION_CATALOGUE,
  ERROR_CATALOGUE,
  LOG_EVENT,
  REQUEST_ID_PATTERN,
  RETRY_POLICY,
  STATUS_FALLBACK,
  TOAST_DURATIONS_MS,
  type ActionSpec,
  type ErrorCode,
  type ErrorSpec,
  type UserAction,
} from './generated/feedback.js';
import { VoteEligibilityValidationError } from './voting.js';

export { ACTION_CATALOGUE, ERROR_CATALOGUE, LOG_EVENT, RETRY_POLICY, TOAST_DURATIONS_MS };
export type {
  ActionSpec,
  ErrorCode,
  ErrorSpec,
  LogLevel,
  Presentation,
  ToastDuration,
  ToastTone,
  UserAction,
} from './generated/feedback.js';

const specsByCode = new Map(ERROR_CATALOGUE.map((spec) => [spec.code, spec]));
const specsByAction = new Map(ACTION_CATALOGUE.map((spec) => [spec.action, spec]));

export function errorSpec(code: ErrorCode): ErrorSpec {
  return specsByCode.get(code)!;
}

export function actionSpec(action: UserAction): ActionSpec {
  return specsByAction.get(action)!;
}

/** A wire code this build knows, or `undefined` (a newer server) so callers use the HTTP status. */
export function errorCodeFromWire(raw: string | undefined): ErrorCode | undefined {
  return specsByCode.has(raw as ErrorCode) ? (raw as ErrorCode) : undefined;
}

export function codeForHttpStatus(status: number): ErrorCode {
  return STATUS_FALLBACK.find((r) => status >= r.from && status <= r.to)?.code ?? 'server.internal';
}

/**
 * Equal jitter: `half + random × half`, `half = min(max, base × 2^(retry−1)) / 2` (REQ-ERR-005).
 * `NaN` counts as the first retry and as no jitter, like Rust's `u32`/`clamp`/`as u64`
 * (REQ-ROB-009) — `Math.max(NaN, 0)` is `NaN`, and `setTimeout(NaN)` fires at once.
 */
export function retryDelayMs(retry: number, random: number): number {
  const step = Number.isNaN(retry) ? 0 : Math.min(Math.max(retry - 1, 0), 16);
  const jitter = Number.isNaN(random) ? 0 : Math.min(Math.max(random, 0), 1);
  const exponential = RETRY_POLICY.baseDelayMs * 2 ** step;
  const half = Math.floor(Math.min(exponential, RETRY_POLICY.maxDelayMs) / 2);
  return half + Math.floor(jitter * half);
}

/** `Retry-After` in whole seconds, capped at the policy maximum; anything else is `null`. */
export function retryAfterMs(header: string): number | null {
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Math.min(Number(trimmed) * 1000, RETRY_POLICY.maxDelayMs);
}

/** Same rule as Rust's `is_valid_request_id`: ids are logged and shown, so they must be inert. */
export function isValidRequestId(id: string): boolean {
  return REQUEST_ID_PATTERN.test(id);
}

/** Every failure a client sees, classified against the catalogue. `message` is for logs only. */
export class TranRequestError extends Error {
  public readonly code: ErrorCode;
  public readonly spec: ErrorSpec;
  public readonly requestId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    public readonly status: number | null = null,
    requestId?: string,
    public readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = 'TranRequestError';
    // A code this build does not know must not make the error handler throw (REQ-ROB-005).
    this.code = specsByCode.has(code) ? code : 'client.unexpected';
    this.spec = errorSpec(this.code);
    this.requestId = requestId !== undefined && isValidRequestId(requestId) ? requestId : undefined;
  }
}

/** Transport failures are `DOMException`s named by `TranApiClient` (REQ-ROB-002). */
const TRANSPORT_CODES: Readonly<Record<string, ErrorCode>> = {
  TimeoutError: 'network.timeout',
  AbortError: 'request.cancelled',
  NetworkError: 'network.offline',
};

function classifyKnown(err: unknown): TranRequestError {
  if (err instanceof TranRequestError) return err;
  if (err instanceof TranApiError) {
    const code = errorCodeFromWire(err.code) ?? codeForHttpStatus(err.status);
    const retryAfter = err.retryAfter === undefined ? null : retryAfterMs(err.retryAfter);
    return new TranRequestError(code, err.message, err.status, err.requestId, retryAfter);
  }
  if (err instanceof VoteEligibilityValidationError) {
    return new TranRequestError(err.code, err.message);
  }
  if (err instanceof DOMException && Object.hasOwn(TRANSPORT_CODES, err.name)) {
    return new TranRequestError(TRANSPORT_CODES[err.name], err.message);
  }
  // Anything else — a TypeError included — is a bug in the client, never "offline".
  return new TranRequestError(
    'client.unexpected',
    err instanceof Error ? err.message : String(err)
  );
}

/**
 * REQ-ERR-004: envelope code → HTTP status → transport failure → client bug. Total (REQ-ROB-005):
 * values that throw when inspected (revoked proxies, prototype-less objects, throwing getters)
 * still become `client.unexpected`.
 */
export function classifyError(err: unknown): TranRequestError {
  try {
    return classifyKnown(err);
  } catch {
    return new TranRequestError('client.unexpected', 'unclassifiable failure');
  }
}

export interface RetryOptions {
  /** Only idempotent requests are retried; the eligibility check is a pure computation. */
  idempotent: boolean;
  sleep?: (ms: number) => Promise<void>;
  /** `[0, 1)`; injected so the schedule is deterministic in tests. */
  random?: () => number;
  onRetry?: (error: TranRequestError, retry: number, delayMs: number) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `call` up to `RETRY_POLICY.maxAttempts` times; throws the last failure, classified. */
export async function withRetry<T>(call: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { idempotent, sleep = realSleep, random = Math.random, onRetry } = options;
  const attempt = async (n: number): Promise<T> => {
    try {
      return await call();
    } catch (raw) {
      const error = classifyError(raw);
      const canRetry = idempotent && error.spec.retryable && n < RETRY_POLICY.maxAttempts;
      if (!canRetry) throw error;
      const delay = error.retryAfterMs ?? retryDelayMs(n, random());
      onRetry?.(error, n, delay);
      await sleep(delay);
      return attempt(n + 1);
    }
  };
  return attempt(1);
}

export type FeedbackLogger = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

/**
 * The one `LOG_EVENT` per failure, at the catalogue level, with the same field names as the server
 * and native apps (REQ-ROB-007). The user-facing side is decided by `spec.presentation`.
 */
export function logFailure(error: TranRequestError, logger: FeedbackLogger = console): void {
  logger[error.spec.logLevel](LOG_EVENT.message, {
    code: error.code,
    status: error.status,
    request_id: error.requestId,
    detail: error.message,
  });
}
