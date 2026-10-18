import { z } from 'zod';

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export interface ActionContext {
  userId: string;
  userRole?: string;
}

/**
 * Creates a type-safe Server Action handler with automatic Zod input validation
 * and authentication guards.
 * Inspired by `midday-ai/midday` and `calcom/cal.com`.
 */
export function createSafeAction<TInput, TOutput>(opts: {
  schema: z.ZodSchema<TInput>;
  requireAuth?: boolean;
  getAuth?: () => Promise<ActionContext | null>;
  handler: (input: TInput, ctx: ActionContext | null) => Promise<TOutput>;
}) {
  return async (rawInput: unknown): Promise<ActionResponse<TOutput>> => {
    try {
      let ctx: ActionContext | null = null;

      if (opts.requireAuth ?? true) {
        if (!opts.getAuth) {
          throw new Error('Authentication handler not configured for protected action');
        }
        ctx = await opts.getAuth();
        if (!ctx) {
          return { success: false, error: 'Unauthorized: Valid session required' };
        }
      }

      const parseResult = opts.schema.safeParse(rawInput);
      if (!parseResult.success) {
        return {
          success: false,
          error: 'Validation failed',
          fieldErrors: parseResult.error.flatten().fieldErrors,
        };
      }

      const data = await opts.handler(parseResult.data, ctx);
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      return { success: false, error: message };
    }
  };
}
