// Verifies: REQ-DB-011 REQ-DB-012
/**
 * Client stored record versioning and migration (spec 030, ADR-0049).
 *
 * Reading any stored record goes through `storedRecord`. Matching schema is used directly,
 * older schema is upgraded via a pure function, and newer/corrupt schema is discarded.
 */

import { STORED_RECORD_SCHEMAS, type StoredRecordAction } from './generated/rules.js';

export { STORED_RECORD_SCHEMAS, StoredRecordAction };

/**
 * The one decision every client makes when reading a stored record (REQ-DB-011).
 */
export function storedRecord(schema: number, current: number): StoredRecordAction {
  if (schema <= 0 || current <= 0 || !Number.isInteger(schema) || !Number.isInteger(current)) {
    return 'discard';
  }
  if (schema === current) {
    return 'use';
  }
  if (schema < current) {
    return 'upgrade';
  }
  return 'discard';
}

/** Stored session vault record shape (REQ-SEC-017, REQ-DB-011). */
export interface StoredSessionRecord {
  schema: number;
  userId: string;
  role: string;
  refreshToken: string;
}

/** Stored push notification registration shape (REQ-PSH-010, REQ-DB-011). */
export interface StoredPushRecord {
  schema: number;
  token: string;
  registeredAtUnixS: number;
}

/** Stored remote configuration cache shape (REQ-CFG-005, REQ-DB-011). */
export interface StoredConfigRecord {
  schema: number;
  flags: Record<string, boolean | number | string>;
  client?: {
    minimumVersion?: string | null;
    recommendedVersion?: string | null;
  };
  configVersion: number;
}

function parseRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

/**
 * Read and optionally upgrade a session vault record (REQ-DB-011, REQ-DB-012).
 */
export function readStoredSession(
  raw: unknown,
  currentSchema = STORED_RECORD_SCHEMAS.session
): StoredSessionRecord | null {
  const obj = parseRecord(raw);
  if (!obj) return null;

  const schema = typeof obj.schema === 'number' ? obj.schema : 1;
  const decision = storedRecord(schema, currentSchema);

  if (decision === 'discard') return null;

  const userId = (obj.user_id ?? obj.userId) as string | undefined;
  const role = obj.role as string | undefined;
  const refreshToken = (obj.refresh_token ?? obj.refreshToken) as string | undefined;

  if (typeof userId !== 'string' || typeof role !== 'string' || typeof refreshToken !== 'string') {
    return null;
  }

  return {
    schema: decision === 'upgrade' ? currentSchema : schema,
    userId,
    role,
    refreshToken,
  };
}

/**
 * Read and optionally upgrade a push registration record (REQ-DB-011).
 */
export function readStoredPush(
  raw: unknown,
  currentSchema = STORED_RECORD_SCHEMAS.push
): StoredPushRecord | null {
  const obj = parseRecord(raw);
  if (!obj) return null;

  const schema = typeof obj.schema === 'number' ? obj.schema : 1;
  const decision = storedRecord(schema, currentSchema);

  if (decision === 'discard') return null;

  const token = obj.token as string | undefined;
  const registeredAt = (obj.registered_at_unix_s ?? obj.registeredAtUnixS) as number | undefined;

  if (typeof token !== 'string' || typeof registeredAt !== 'number') {
    return null;
  }

  return {
    schema: decision === 'upgrade' ? currentSchema : schema,
    token,
    registeredAtUnixS: registeredAt,
  };
}

/**
 * Read and optionally upgrade a cached configuration record (REQ-DB-011).
 */
export function readStoredConfig(
  raw: unknown,
  currentSchema = STORED_RECORD_SCHEMAS.config
): StoredConfigRecord | null {
  const obj = parseRecord(raw);
  if (!obj) return null;

  const schema = typeof obj.schema === 'number' ? obj.schema : 1;
  const decision = storedRecord(schema, currentSchema);

  if (decision === 'discard') return null;

  const flags = obj.flags;
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    return null;
  }

  const configVersion = (obj.config_version ?? obj.configVersion) as number | undefined;
  if (typeof configVersion !== 'number') {
    return null;
  }

  let clientThresholds: StoredConfigRecord['client'] = undefined;
  if (obj.client && typeof obj.client === 'object' && !Array.isArray(obj.client)) {
    const c = obj.client as Record<string, unknown>;
    clientThresholds = {
      minimumVersion: ((c.minimum_version ?? c.minimumVersion) as string | null) ?? null,
      recommendedVersion:
        ((c.recommended_version ?? c.recommendedVersion) as string | null) ?? null,
    };
  }

  return {
    schema: decision === 'upgrade' ? currentSchema : schema,
    flags: flags as Record<string, boolean | number | string>,
    client: clientThresholds,
    configVersion,
  };
}
