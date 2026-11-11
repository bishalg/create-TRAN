// Verifies: REQ-CFG-001 REQ-CFG-003 REQ-CFG-006 REQ-CFG-007 REQ-CFG-010
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_FLAGS,
  BUCKET_HEADER,
  CONFIG_POLICY,
  ClientEvaluationContext,
  deriveBucket,
  deriveBucketAsync,
  evaluate,
  findFlag,
  FLAG_NOTIFY_ME,
  FlagDefinition,
  Rule,
} from '../src/flags.js';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const FIXTURE_PATH = path.join(ROOT, 'fixtures/flags.json');
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('flags catalogue and constants (REQ-CFG-001, REQ-CFG-007)', () => {
  it('defines headers and flag ids', () => {
    expect(BUCKET_HEADER).toBe('X-Tran-Bucket');
    expect(FLAG_NOTIFY_ME).toBe('notify_me');
    expect(CONFIG_POLICY.maxAgeSeconds).toBe(300);
  });

  it('matches flags in fixture', () => {
    expect(ALL_FLAGS.length).toBe(fixture.flags.length);
    for (const expected of fixture.flags) {
      const actual = findFlag(expected.id);
      expect(actual).toBeDefined();
      expect(actual?.flagType).toBe(expected.type);
      expect(actual?.defaultValue).toBe(expected.defaultValue);
      expect(actual?.live).toBe(expected.live);
      expect(actual?.owner).toBe(expected.owner);
      expect(actual?.purpose).toBe(expected.purpose);
      expect(actual?.expiry).toBe(expected.expiry);
    }
  });

  it('returns undefined for unknown flag', () => {
    expect(findFlag('unknown_flag')).toBeUndefined();
  });
});

describe('deriveBucket parity (REQ-CFG-006)', () => {
  it('derives bucket synchronously matching fixture cases', () => {
    for (const item of fixture.buckets) {
      const bucket = deriveBucket(item.installationId);
      expect(bucket).toBe(item.bucket);
    }
  });

  it('derives bucket asynchronously via subtle crypto matching fixture cases', async () => {
    for (const item of fixture.buckets) {
      const bucket = await deriveBucketAsync(item.installationId);
      expect(bucket).toBe(item.bucket);
    }
  });
});

describe('evaluate pure function parity (REQ-CFG-003)', () => {
  it('matches all evaluation test cases from fixture', () => {
    for (const testCase of fixture.evaluations) {
      const flag = findFlag(testCase.flag);
      expect(flag).toBeDefined();
      const actual = evaluate(
        flag!,
        testCase.rules as Rule[],
        testCase.client as ClientEvaluationContext
      );
      expect(actual).toBe(testCase.expected);
    }
  });

  it('returns default when no rules match or rules list is empty', () => {
    const flag: FlagDefinition = {
      id: 'test',
      flagType: 'boolean',
      defaultValue: false,
      live: true,
      owner: 'core',
      purpose: 'test',
      expiry: '2027-01-01',
    };
    const client: ClientEvaluationContext = {
      platform: 'ios',
      version: '1.0.0',
      bucket: 50,
    };
    expect(evaluate(flag, [], client)).toBe(false);
  });

  it('evaluates integer and string flags and checks value types', () => {
    const intFlag: FlagDefinition = {
      id: 'int_flag',
      flagType: 'integer',
      defaultValue: 10,
      live: true,
      owner: 'core',
      purpose: 'test',
      expiry: '2027-01-01',
    };
    const strFlag: FlagDefinition = {
      id: 'str_flag',
      flagType: 'string',
      defaultValue: 'default_str',
      live: true,
      owner: 'core',
      purpose: 'test',
      expiry: '2027-01-01',
    };
    const client: ClientEvaluationContext = {
      platform: 'android',
      version: '1.0.0',
      bucket: 10,
    };

    expect(evaluate(intFlag, [{ value: 42 }], client)).toBe(42);
    expect(evaluate(intFlag, [{ value: 'not-an-int' }], client)).toBe(10);

    expect(evaluate(strFlag, [{ value: 'custom_str' }], client)).toBe('custom_str');
    expect(evaluate(strFlag, [{ value: true }], client)).toBe('default_str');
  });

  it('skips min_version rule when client version is missing', () => {
    const flag: FlagDefinition = {
      id: 'flag',
      flagType: 'boolean',
      defaultValue: false,
      live: true,
      owner: 'core',
      purpose: 'test',
      expiry: '2027-01-01',
    };
    const clientWithoutVersion: ClientEvaluationContext = {
      platform: 'web',
      bucket: 5,
    };
    expect(evaluate(flag, [{ min_version: '1.0.0', value: true }], clientWithoutVersion)).toBe(
      false
    );
  });
});

describe('deriveBucketAsync fallback (REQ-CFG-006)', () => {
  it('falls back to sync deriveBucket when subtle crypto is absent', async () => {
    const originalSubtle = globalThis.crypto?.subtle;
    try {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: undefined,
        configurable: true,
      });
      const bucket = await deriveBucketAsync('2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c');
      expect(bucket).toBe(83);
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: originalSubtle,
        configurable: true,
      });
    }
  });
});
