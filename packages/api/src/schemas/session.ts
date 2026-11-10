import { wireEnum } from '../compat.js';
import { USER_ROLE } from '../generated/compat.js';
import { z } from './zod.js';

/**
 * Who a session belongs to: `GET /api/v1/auth/session` and the `user` of every token answer. A
 * role a newer server adds reads as the declared fallback, the voter (REQ-VER-008).
 */
export const SessionUserSchema = z.object({
  user_id: z.string(),
  role: wireEnum(USER_ROLE),
});

/**
 * The answer to `POST /api/v1/auth/session` and `POST /api/v1/auth/refresh` (spec 022). On the cookie
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
