/**
 * The wire contract's versioning helpers (spec 028): every path is built on the generated base
 * path, so no client spells the version (REQ-VER-001), and every wire enum decodes tolerantly to
 * its declared fallback (REQ-VER-008). The constants come from Rust through `pnpm tokens:sync`.
 */
import { API_BASE_PATH } from './generated/compat.js';
import { z } from './schemas/zod.js';

export * from './generated/compat.js';

/** `/auth/session` → `/api/v1/auth/session`. */
export function apiPath<const P extends `/${string}`>(path: P): `${typeof API_BASE_PATH}${P}` {
  return `${API_BASE_PATH}${path}`;
}

/**
 * A string field read tolerantly: a value this build knows is kept, any other string (a newer
 * server's) becomes the enum's fallback. A missing field or another type still fails the parse.
 */
export function wireEnum<const V extends readonly string[]>(wire: {
  readonly values: V;
  readonly fallback: V[number];
}) {
  const known = new Set<string>(wire.values);
  return z
    .string()
    .transform((raw): V[number] => (known.has(raw) ? (raw as V[number]) : wire.fallback));
}
