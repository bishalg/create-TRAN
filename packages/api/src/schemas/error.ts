import { z } from 'zod';

/** The Axum error envelope (REQ-ERR-002). `code`/`retryable`/`request_id` are optional so bodies from
 * older servers and proxies still parse; clients then classify by HTTP status (REQ-ERR-004). */
export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
  request_id: z.string().optional(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
