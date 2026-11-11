// Verifies: REQ-CFG-002 REQ-CFG-008
//! Remote configuration response schemas (spec 029, ADR-0048).
import { z } from './zod.js';

export const ClientThresholdsSchema = z.object({
  minimum_version: z.string().nullable().optional(),
  recommended_version: z.string().nullable().optional(),
});

export const RemoteConfigResponseSchema = z.object({
  config_version: z.number(),
  flags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  client: ClientThresholdsSchema,
});

export type RemoteConfigResponse = z.infer<typeof RemoteConfigResponseSchema>;
export type ClientThresholdsResponse = z.infer<typeof ClientThresholdsSchema>;
