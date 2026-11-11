// Verifies: REQ-DB-011
/**
 * Client stored-record versioning (spec 030, ADR-0049). Every record a client keeps carries the
 * schema it was written in, and reading one starts with this decision: the same schema is used,
 * an older one upgraded, a newer or malformed one discarded. The current schemas come from Rust
 * (`STORED_RECORD_SCHEMAS`, ADR-0027); the decision is pinned by `fixtures/stored-records.json`.
 * Each record's own reader lives beside the store that owns it (`remote-config.ts` on the web).
 */

import { STORED_RECORD_SCHEMAS, type StoredRecordAction } from './generated/rules.js';

export { STORED_RECORD_SCHEMAS, type StoredRecordAction };

/** The version of a record written before records carried `schema`: the first release. */
const LEGACY_SCHEMA = 1;
const MAX_SCHEMA = 0xffff_ffff;

/**
 * The version a stored `schema` value names (`stored_schema` in Rust): no value is the first
 * release; otherwise a whole number from 1 to 2^32 − 1. Anything else (a string, a negative or
 * fractional number, 0, a larger number, `null`) makes the record unreadable: `null`.
 */
export function storedSchema(value: unknown): number | null {
  if (value === undefined) return LEGACY_SCHEMA;
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SCHEMA
    ? (value as number)
    : null;
}

/** The one decision every client makes when reading a stored record (REQ-DB-011). */
export function storedRecord(schema: number, current: number): StoredRecordAction {
  if (!Number.isInteger(schema) || !Number.isInteger(current) || schema <= 0 || current <= 0) {
    return 'discard';
  }
  if (schema === current) return 'use';
  return schema < current ? 'upgrade' : 'discard';
}
