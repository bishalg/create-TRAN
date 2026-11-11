// Verifies: REQ-CFG-001 REQ-CFG-004 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as core from '../src/index.js';
import {
  ALL_FLAGS,
  BUCKET_HEADER,
  CONFIG_POLICY,
  deriveBucket,
  FLAGS,
  readFlags,
} from '../src/index.js';

interface FlagsFixture {
  flags: {
    id: string;
    type: string;
    defaultValue: unknown;
    live: boolean;
    owner: string;
    purpose: string;
    expiry: string;
  }[];
  buckets: { installationId: string; bucket: number }[];
}

const fixture: FlagsFixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/flags.json', import.meta.url), 'utf8')
);

describe('the generated catalogue (REQ-CFG-001)', () => {
  it('carries every flag of the fixture, field for field', () => {
    expect(
      ALL_FLAGS.map(({ id, flagType, defaultValue, live, owner, purpose, expiry }) => ({
        id,
        type: flagType,
        defaultValue,
        live,
        owner,
        purpose,
        expiry,
      }))
    ).toEqual(fixture.flags);
  });

  it('carries the policy and the bucket header', () => {
    expect(CONFIG_POLICY.maxAgeSeconds).toBe(300);
    expect(BUCKET_HEADER).toBe('X-Tran-Bucket');
  });

  it('every accessor names a declared flag with its default', () => {
    for (const accessor of Object.values(FLAGS)) {
      const declared = ALL_FLAGS.find((flag) => flag.id === accessor.id);
      expect(declared?.defaultValue).toBe(accessor.defaultValue);
      expect(declared?.live).toBe(accessor.live);
    }
  });

  it('no hand-written copy of the catalogue or of evaluate is exported', () => {
    for (const name of ['FLAG_NOTIFY_ME', 'findFlag', 'evaluate', 'deriveBucketAsync']) {
      expect(Object.keys(core), name).not.toContain(name);
    }
  });
});

describe('typed accessors read a wrong-typed value as the default (REQ-CFG-005, REQ-CFG-007)', () => {
  it.each([
    ['a real true', { notify_me: true }, true],
    ['a real false', { notify_me: false }, false],
    ['the string "true"', { notify_me: 'true' }, false],
    ['the string "false"', { notify_me: 'false' }, false],
    ['the number 1', { notify_me: 1 }, false],
    ['null', { notify_me: null }, false],
    ['a missing flag', {}, false],
    ['no values at all', null, false],
  ])('notify_me from %s', (_name, values, expected) => {
    expect(FLAGS.notifyMe.get(values)).toBe(expected);
  });

  it('a live flag follows the latest values, not the launch values', () => {
    expect(readFlags({ notify_me: false }, { notify_me: true })).toEqual({ notifyMe: true });
    expect(readFlags({ notify_me: true }, null)).toEqual({ notifyMe: false });
  });
});

describe('deriveBucket uses Web Crypto and matches every platform (REQ-CFG-006)', () => {
  it.each(fixture.buckets)('$installationId → $bucket', async ({ installationId, bucket }) => {
    expect(await deriveBucket(installationId)).toBe(bucket);
  });

  it('folds ASCII case only, as Rust does', async () => {
    const id = 'ÄBC-def';
    const digest = createHash('sha256').update('Äbc-def').digest();
    expect(await deriveBucket(id)).toBe(digest.readUInt32BE(0) % 100);
  });

  it('is null where Web Crypto is unavailable (an insecure origin): no bucket is sent', async () => {
    expect(await deriveBucket('2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c', null)).toBeNull();
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues });
    try {
      expect(await deriveBucket('2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
