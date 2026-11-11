/**
 * The schema each route's answer is read with, keyed as the contract snapshots and
 * `fixtures/compat.json` name routes. A route answering `204` has no body; any failure is the
 * envelope.
 */
import type { ZodType } from 'zod';
import { apiPath, HEALTH_PATH } from '../../src/compat.js';
import { ErrorEnvelopeSchema } from '../../src/schemas/error.js';
import { HealthReportSchema, StackInfoSchema } from '../../src/schemas/info.js';
import { SessionTokenSchema, SessionUserSchema } from '../../src/schemas/session.js';
import { RemoteConfigResponseSchema } from '../../src/schemas/config.js';
import {
  CountriesSchema,
  CountryVotingAgeSchema,
  VoteEligibilityOutputSchema,
} from '../../src/schemas/vote.js';

export const SUCCESS_SCHEMAS: Record<string, ZodType> = {
  [`GET ${HEALTH_PATH}`]: HealthReportSchema,
  [`GET ${apiPath('/tran/info')}`]: StackInfoSchema,
  [`GET ${apiPath('/config')}`]: RemoteConfigResponseSchema,
  [`GET ${apiPath('/vote/countries')}`]: CountriesSchema,
  [`GET ${apiPath('/vote/countries/{code}')}`]: CountryVotingAgeSchema,
  [`POST ${apiPath('/vote/eligibility')}`]: VoteEligibilityOutputSchema,
  [`POST ${apiPath('/auth/session')}`]: SessionTokenSchema,
  [`POST ${apiPath('/auth/refresh')}`]: SessionTokenSchema,
  [`GET ${apiPath('/auth/session')}`]: SessionUserSchema,
};

/** The schema an answer of `route` with `status` is read with; `null` for a body-less `204`. */
export function schemaFor(route: string, status: number): ZodType | null {
  if (status === 204) return null;
  if (status < 200 || status > 299) return ErrorEnvelopeSchema;
  const schema = SUCCESS_SCHEMAS[route];
  if (!schema) throw new Error(`no schema reads ${route}: add it to tests/helpers/routes.ts`);
  return schema;
}

/** `user.role` or `components.0.name` inside `value`. */
export function at(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);
}
