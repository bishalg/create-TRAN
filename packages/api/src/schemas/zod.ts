import { z } from 'zod';

/**
 * Zod without its JIT. The built web app's CSP has no `'unsafe-eval'` (REQ-SEC-024): zod's fast
 * path compiles parsers with `new Function`, and even its probe for that is reported as a CSP
 * violation. Every schema imports `z` from here, so this runs before any schema is defined.
 */
z.config({ jitless: true });

export { z };
