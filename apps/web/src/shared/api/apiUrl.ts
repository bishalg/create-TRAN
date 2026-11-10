/**
 * Where the API lives. Pure, without `import.meta.env`, so `vite.config.ts` uses it too: the CSP
 * of the production build allows exactly this origin (REQ-SEC-024).
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/** `VITE_TRAN_API_URL`, or the local API. */
export function resolveApiBaseUrl(env: { VITE_TRAN_API_URL?: string } = {}): string {
  return env.VITE_TRAN_API_URL ? env.VITE_TRAN_API_URL : DEFAULT_API_URL;
}
