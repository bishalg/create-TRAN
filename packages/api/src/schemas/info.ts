import { z } from './zod.js';

/**
 * `GET /api/health`, unversioned (REQ-API-012, REQ-VER-001). Read tolerantly: a field a newer
 * server adds is ignored (REQ-VER-008).
 */
export const HealthReportSchema = z.object({
  report_id: z.string(),
  timestamp: z.string(),
  overall_status: z.string(),
  components: z.array(
    z.object({
      layer: z.string(),
      name: z.string(),
      version: z.string(),
      healthy: z.boolean(),
      uptime_seconds: z.number(),
    })
  ),
});

/** `GET /api/v1/tran/info`: what the stack is and which version answers. */
export const StackInfoSchema = z.object({
  stack: z.string(),
  description: z.string(),
  demo: z.string().optional(),
  layers: z.object({ T: z.string(), R: z.string(), A: z.string(), N: z.string() }),
  version: z.string(),
});

export type HealthReport = z.infer<typeof HealthReportSchema>;
export type StackInfo = z.infer<typeof StackInfoSchema>;
