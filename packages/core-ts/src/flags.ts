// Verifies: REQ-CFG-006
/**
 * The device side of the rollout bucket (spec 029, REQ-CFG-006). The catalogue, its typed
 * accessors, the policy and the header are generated from Rust (`./generated/flags.ts`, ADR-0027);
 * rules are evaluated by the server only, so no client keeps a copy of `evaluate`.
 *
 * Web Crypto, not `node:crypto`: this file is bundled into the browser.
 */

/** ASCII letters folded to lower case, nothing else: Rust's `to_ascii_lowercase`. */
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The bucket, 0 to 99, from an installation id: the first four bytes of SHA-256 of the trimmed,
 * ASCII-lowercased id, big-endian, modulo 100 (`derive_bucket`, pinned by `fixtures/flags.json`).
 * `null` where Web Crypto is missing (an insecure origin): the client then sends no bucket.
 */
export async function deriveBucket(
  installationId: string,
  subtle: SubtleCrypto | null = globalThis.crypto.subtle ?? null
): Promise<number | null> {
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(asciiLower(installationId.trim()));
  const digest = await subtle.digest('SHA-256', bytes);
  return new DataView(digest).getUint32(0, false) % 100;
}
