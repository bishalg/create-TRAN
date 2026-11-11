import type { ContractRouterClient } from '@orpc/contract';
import { apiPath } from './compat.js';
import type { TranContract } from './contract.js';
import { ErrorEnvelopeSchema } from './schemas/error.js';
import { childSpanContext, formatTraceparent, newTraceContext, parseTraceparent } from './trace.js';
import {
  VoteEligibilityInputSchema,
  VoteEligibilityOutputSchema,
  type VoteEligibilityInput,
  type VoteEligibilityOutput,
} from './schemas/vote.js';

export interface TranApiErrorDetails {
  /** Catalogue code from the envelope (`validation.invalid_country_code`); absent for foreign bodies. */
  code?: string;
  requestId?: string;
  traceId?: string;
  /** Raw `Retry-After` header. */
  retryAfter?: string;
}

/** An HTTP response was received but it was not a success. Network failures are NOT wrapped. */
export class TranApiError extends Error {
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly traceId?: string;
  public readonly retryAfter?: string;

  constructor(
    message: string,
    public readonly status: number,
    details: TranApiErrorDetails = {}
  ) {
    super(message);
    this.name = 'TranApiError';
    this.code = details.code;
    this.requestId = details.requestId;
    this.traceId = details.traceId;
    this.retryAfter = details.retryAfter;
  }
}

/** The one place a non-2xx response is read (REQ-ERR-002/004); `message` is for developers only. */
export async function readApiError(
  response: Response,
  injectedTraceId?: string
): Promise<TranApiError> {
  const header = (name: string) => response.headers?.get(name) ?? undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  const parsed = envelope.success ? envelope.data : undefined;
  const tpHeader = header('traceparent');
  const parsedTp = tpHeader ? parseTraceparent(tpHeader) : null;
  const traceId = injectedTraceId ?? parsedTp?.traceId;
  return new TranApiError(parsed?.error ?? `HTTP ${response.status}`, response.status, {
    code: parsed?.code,
    requestId: parsed?.request_id ?? header('x-request-id'),
    traceId,
    retryAfter: header('retry-after'),
  });
}

export interface TranOrpcClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
  /** Cancels the request; the rejection is the fetch `AbortError`. */
  signal?: AbortSignal;
}

/** Contract-shaped client; Axum implements REST, not the binary oRPC wire protocol. */
export type TranOrpcClient = ContractRouterClient<TranContract>;

export function createTranOrpcClient(options: TranOrpcClientOptions = {}): {
  vote: { eligibility: (input: VoteEligibilityInput) => Promise<VoteEligibilityOutput> };
} {
  return {
    vote: {
      eligibility: (input) => checkVoteEligibility(input, options),
    },
  };
}

/** REST + Zod validation against the oRPC contract schemas (REQ-OBS-010). */
export async function checkVoteEligibility(
  input: VoteEligibilityInput,
  options: TranOrpcClientOptions = {}
): Promise<VoteEligibilityOutput> {
  const parsed = VoteEligibilityInputSchema.parse(input);
  const baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  const incomingTp = options.headers?.traceparent ?? options.headers?.Traceparent;
  const parsedIncoming = incomingTp ? parseTraceparent(incomingTp) : null;
  const traceCtx = parsedIncoming
    ? childSpanContext(parsedIncoming.traceId, parsedIncoming.sampled)
    : newTraceContext();
  const traceparent = formatTraceparent(traceCtx);

  const response = await fetchFn(`${baseUrl}${apiPath('/vote/eligibility')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),
      traceparent,
    },
    body: JSON.stringify(parsed),
    // Only the auth tree may carry the session cookie (REQ-SEC-018).
    credentials: 'omit',
    signal: options.signal,
  });

  if (!response.ok) throw await readApiError(response, traceCtx.traceId);

  const json = await response.json();
  return VoteEligibilityOutputSchema.parse(json);
}
