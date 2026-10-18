import { z } from 'zod';

export const VoteEligibilityInputSchema = z.object({
  age: z.number().int().min(0).max(150),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const VoteEligibilityOutputSchema = z.object({
  eligibility_id: z.string().uuid(),
  eligible: z.boolean(),
  age: z.number().int(),
  minimum_age: z.number().int(),
  country_code: z.string(),
  country_source: z.string(),
  client_ip: z.string(),
  reason: z.string(),
  evaluated_at: z.string(),
});

export type VoteEligibilityInput = z.infer<typeof VoteEligibilityInputSchema>;
export type VoteEligibilityOutput = z.infer<typeof VoteEligibilityOutputSchema>;
