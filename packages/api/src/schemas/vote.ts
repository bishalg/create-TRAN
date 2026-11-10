import { wireEnum } from '../compat.js';
import { COUNTRY_SOURCE } from '../generated/compat.js';
import { z } from './zod.js';

export const VoteEligibilityInputSchema = z.object({
  age: z.number().int().min(0).max(150),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const VoteEligibilityOutputSchema = z.object({
  eligibility_id: z.uuid(),
  eligible: z.boolean(),
  age: z.number().int(),
  minimum_age: z.number().int(),
  country_code: z.string(),
  /** How the server chose the country; an unknown source reads as `default` (REQ-VER-008). */
  country_source: wireEnum(COUNTRY_SOURCE),
  client_ip: z.string(),
  reason: z.string(),
  evaluated_at: z.string(),
});

/** One supported country: `GET /api/v1/vote/countries/{code}` and each item of the list. */
export const CountryVotingAgeSchema = z.object({
  country_code: z.string(),
  minimum_age: z.number().int(),
});

/** `GET /api/v1/vote/countries`. */
export const CountriesSchema = z.object({ countries: z.array(CountryVotingAgeSchema) });

export type VoteEligibilityInput = z.infer<typeof VoteEligibilityInputSchema>;
export type VoteEligibilityOutput = z.infer<typeof VoteEligibilityOutputSchema>;
