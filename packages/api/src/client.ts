import type { ContractRouterClient } from '@orpc/contract';
import type { TranContract } from './contract.js';
import {
  VoteEligibilityInputSchema,
  VoteEligibilityOutputSchema,
  type VoteEligibilityInput,
  type VoteEligibilityOutput,
} from './schemas/vote.js';

/** An HTTP response was received but it was not a success. Network failures are NOT wrapped. */
export class TranApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'TranApiError';
  }
}

export interface TranOrpcClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
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

/** REST + Zod validation against the oRPC contract schemas. */
export async function checkVoteEligibility(
  input: VoteEligibilityInput,
  options: TranOrpcClientOptions = {}
): Promise<VoteEligibilityOutput> {
  const parsed = VoteEligibilityInputSchema.parse(input);
  const baseUrl = (options.baseUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);

  const response = await fetchFn(`${baseUrl}/api/vote/eligibility`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(parsed),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new TranApiError(message, response.status);
  }

  const json = await response.json();
  return VoteEligibilityOutputSchema.parse(json);
}
