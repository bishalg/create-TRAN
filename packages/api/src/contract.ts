import { oc } from '@orpc/contract';
import { apiPath } from './compat.js';
import { VoteEligibilityInputSchema, VoteEligibilityOutputSchema } from './schemas/vote.js';

/**
 * Type-safe API contract. Axum implements the REST route; responses are validated
 * on the client with these Zod schemas (oRPC server on Rust is intentionally omitted).
 */
export const tranContract = oc.router({
  vote: {
    eligibility: oc
      .route({
        method: 'POST',
        path: apiPath('/vote/eligibility'),
        successStatus: 200,
      })
      .input(VoteEligibilityInputSchema)
      .output(VoteEligibilityOutputSchema),
  },
});

export type TranContract = typeof tranContract;
