import { z } from './zod.js';

/** Who a session belongs to: `GET /api/auth/session` and the `user` of every token answer. */
export const SessionUserSchema = z.object({
  user_id: z.string(),
  role: z.enum(['citizen_voter', 'election_auditor']),
});

/**
 * The answer to `POST /api/auth/session` and `POST /api/auth/refresh` (spec 022). On the cookie
 * transport the refresh token is a `Set-Cookie` header and never part of this body.
 */
export const SessionTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  user: SessionUserSchema,
});

export type SessionUser = z.infer<typeof SessionUserSchema>;
export type SessionToken = z.infer<typeof SessionTokenSchema>;
