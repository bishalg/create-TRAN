// Verifies: REQ-RULE-001 REQ-RULE-002 REQ-RULE-003 REQ-RULE-004 REQ-RULE-005 REQ-RULE-006 REQ-RULE-007 REQ-RULE-008 REQ-RULE-009 REQ-RULE-010
/**
 * Parity with Rust: runs the exact same golden cases as
 * `crates/rust-core/tests/parity_fixtures.rs` from `fixtures/vote-eligibility.json`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ageFromBirthdate,
  canVoteByAge,
  evaluateVoteEligibilityOffline,
  SUPPORTED_COUNTRIES,
  VoteEligibilityValidationError,
  votingAgeForCountry,
} from '../src/voting.js';

interface Fixtures {
  votingAges: { country: string; minimumAge: number }[];
  countries: { countryCode: string; minimumAge: number }[];
  canVote: { age: number; minimumAge: number; expected: boolean }[];
  ageFromBirthdate: { name: string; birthdate: string; reference: string; expected: number }[];
  invalidBirthdates: string[];
  invalidCountryCodes: string[];
  evaluations: {
    name: string;
    input: { age: number; birthdate?: string };
    countryCode: string;
    referenceDate: string;
    expected: {
      eligible: boolean;
      age: number;
      minimumAge: number;
      countryCode: string;
      reason: string;
      /** FFI-only metadata; the HTTP response shape has no such field. */
      reasonCode?: string;
    };
  }[];
  rejectedEvaluations: {
    name: string;
    input: { age: number; birthdate?: string };
    countryCode: string;
    referenceDate: string;
    error: string;
    /** `VoteValidationError` code in Rust; `validation.<code>` in the catalogue. */
    code: string;
  }[];
}

/** The value `fn` throws, so tests can assert on its fields (`code`, `message`). */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

const fixtures: Fixtures = JSON.parse(
  readFileSync(new URL('../../../fixtures/vote-eligibility.json', import.meta.url), 'utf8')
);

describe('golden fixtures (shared with Rust)', () => {
  it.each(fixtures.votingAges)('votingAgeForCountry($country) = $minimumAge', (c) => {
    expect(votingAgeForCountry(c.country)).toBe(c.minimumAge);
  });

  it('SUPPORTED_COUNTRIES is the fixture table, sorted by code', () => {
    expect(SUPPORTED_COUNTRIES).toEqual(fixtures.countries);
  });

  it.each(fixtures.canVote)('canVoteByAge($age, $minimumAge) = $expected', (c) => {
    expect(canVoteByAge(c.age, c.minimumAge)).toBe(c.expected);
  });

  it.each(fixtures.ageFromBirthdate)('ageFromBirthdate: $name', (c) => {
    expect(ageFromBirthdate(c.birthdate, c.reference)).toBe(c.expected);
  });

  it.each(fixtures.invalidBirthdates)('rejects invalid birthdate %j', (raw) => {
    const err = thrown(() => ageFromBirthdate(raw, '2026-10-18'));
    expect(err).toBeInstanceOf(VoteEligibilityValidationError);
    expect(err).toMatchObject({ code: 'validation.invalid_date' });
    // The log line names the input, quoted so a newline in it cannot forge a second line.
    expect((err as Error).message).toContain(JSON.stringify(raw));
  });

  it.each(fixtures.evaluations)('evaluates: $name', (c) => {
    const result = evaluateVoteEligibilityOffline({
      age: c.input.age,
      birthdate: c.input.birthdate,
      countryCode: c.countryCode,
      referenceDate: c.referenceDate,
    });
    const { reasonCode: _ffiReasonCode, ...httpExpected } = c.expected;
    expect(result).toEqual(httpExpected);
  });

  it.each(fixtures.rejectedEvaluations)('rejects: $name', (c) => {
    const run = () =>
      evaluateVoteEligibilityOffline({
        age: c.input.age,
        birthdate: c.input.birthdate,
        countryCode: c.countryCode,
        referenceDate: c.referenceDate,
      });
    expect(run).toThrow(VoteEligibilityValidationError);
    expect(run).toThrow(c.error);
    expect(thrown(run)).toMatchObject({ code: `validation.${c.code}` });
  });

  it.each(fixtures.invalidCountryCodes)('rejects malformed country code %j', (code) => {
    expect(
      thrown(() =>
        evaluateVoteEligibilityOffline({ age: 30, countryCode: code, referenceDate: '2026-10-18' })
      )
    ).toMatchObject({
      name: 'VoteEligibilityValidationError',
      code: 'validation.invalid_country_code',
    });
  });
});

describe('TypeScript-only input hardening (JSON cannot express these in Rust)', () => {
  const run = (age: number) =>
    evaluateVoteEligibilityOffline({ age, countryCode: 'US', referenceDate: '2026-10-18' });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects age %s', (age) => {
    expect(() => run(age)).toThrow(VoteEligibilityValidationError);
    expect(thrown(() => run(age))).toMatchObject({
      code: 'validation.age_out_of_range',
      message: expect.stringContaining('whole number'),
    });
  });

  it('measures age against today when no reference date is given', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = evaluateVoteEligibilityOffline({
      age: 0,
      countryCode: 'US',
      birthdate: today,
    });
    expect(result.age).toBe(0);
  });

  it('a future birthdate is age 0 when measured directly', () => {
    expect(ageFromBirthdate('2026-10-19', '2026-10-18')).toBe(0);
    expect(ageFromBirthdate('2030-01-01', '2026-10-18')).toBe(0);
  });

  it('accepts the boundary ages 0 and 150', () => {
    expect(run(0).age).toBe(0);
    expect(run(150).age).toBe(150);
  });

  it('rejects an impossible reference date instead of silently rolling over', () => {
    expect(() =>
      evaluateVoteEligibilityOffline({
        age: 20,
        countryCode: 'US',
        birthdate: '2000-01-01',
        referenceDate: '2026-02-30',
      })
    ).toThrow(VoteEligibilityValidationError);
  });
});
