// Verifies: REQ-CFG-001 REQ-CFG-003 REQ-CFG-006 REQ-CFG-007 REQ-CFG-010
import { createHash } from 'node:crypto';
import { compareVersions, type ClientPlatform } from './compat.js';

/** HTTP header carrying caller's derived bucket (0 to 99). */
export const BUCKET_HEADER = 'X-Tran-Bucket';

/** Remote configuration policy (spec 029, REQ-CFG-004). */
export const CONFIG_POLICY = {
  maxAgeSeconds: 300,
} as const;

/** Identifier for the reminder flag (REQ-CFG-007). */
export const FLAG_NOTIFY_ME = 'notify_me';

/** Supported flag types in the catalogue. */
export type FlagType = 'boolean' | 'integer' | 'string';

/** Strongly typed flag values. */
export type FlagValue = boolean | number | string;

/** Declared feature flag definition in the catalogue (REQ-CFG-001). */
export interface FlagDefinition {
  id: string;
  flagType: FlagType;
  defaultValue: FlagValue;
  live: boolean;
  owner: string;
  purpose: string;
  expiry: string;
}

/** The catalogue of all declared feature flags (REQ-CFG-001). */
export const ALL_FLAGS: readonly FlagDefinition[] = [
  {
    id: FLAG_NOTIFY_ME,
    flagType: 'boolean',
    defaultValue: false,
    live: true,
    owner: 'growth',
    purpose: 'Remind voter when registration opens',
    expiry: '2027-01-01',
  },
] as const;

/** Finds a declared flag definition by its ID. */
export function findFlag(id: string): FlagDefinition | undefined {
  return ALL_FLAGS.find((f) => f.id === id);
}

/** A targeting rule within a flag's configuration (REQ-CFG-003). */
export interface Rule {
  platform?: string;
  min_version?: string;
  rollout?: number;
  value: FlagValue;
}

/** The context of the client making a remote config request. */
export interface ClientEvaluationContext {
  platform: ClientPlatform;
  version?: string | null;
  bucket: number;
}

/**
 * Evaluates a feature flag against targeting rules and client context (REQ-CFG-003).
 */
export function evaluate(
  flag: FlagDefinition,
  rules: readonly Rule[],
  client: ClientEvaluationContext
): FlagValue {
  for (const rule of rules) {
    if (rule.platform && rule.platform.toLowerCase() !== client.platform.toLowerCase()) {
      continue;
    }
    if (rule.min_version) {
      if (!client.version || compareVersions(client.version, rule.min_version) < 0) {
        continue;
      }
    }
    const rollout = rule.rollout ?? 100;
    if (client.bucket >= rollout) {
      continue;
    }
    const valueType = typeof rule.value;
    const expectedType =
      flag.flagType === 'boolean' ? 'boolean' : flag.flagType === 'integer' ? 'number' : 'string';
    if (valueType !== expectedType) {
      return flag.defaultValue;
    }
    return rule.value;
  }
  return flag.defaultValue;
}

/**
 * Derives a stable rollout bucket from 0 to 99 from an installation ID (REQ-CFG-006).
 */
export function deriveBucket(installationId: string): number {
  const normalized = installationId.trim().toLowerCase();
  const hash = createHash('sha256').update(normalized).digest();
  return hash.readUInt32BE(0) % 100;
}

/**
 * Asynchronously derives a rollout bucket using Web Crypto (REQ-CFG-006).
 */
export async function deriveBucketAsync(installationId: string): Promise<number> {
  const normalized = installationId.trim().toLowerCase();
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const data = new TextEncoder().encode(normalized);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const view = new DataView(hashBuffer);
    return view.getUint32(0, false) % 100;
  }
  return deriveBucket(installationId);
}
