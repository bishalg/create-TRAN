// Verifies: REQ-ROB-009 REQ-ROB-005
/**
 * Invariants over generated input (fast-check). A failure prints a shrunk counter-example: add it
 * to `fixtures/` as a golden row when it reveals a bug, so Rust and native are checked too.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyError,
  isValidRequestId,
  RETRY_POLICY,
  retryAfterMs,
  retryDelayMs,
  TranRequestError,
} from '../src/feedback.js';
import {
  ageFromBirthdate,
  evaluateVoteEligibilityOffline,
  MAX_AGE,
  parseAgeInput,
  VoteEligibilityValidationError,
} from '../src/voting.js';

/** ISO dates over the whole four-digit range the parser accepts. */
const isoDate = fc
  .date({
    min: new Date('0000-01-01T00:00:00Z'),
    max: new Date('9999-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

describe('properties (REQ-ROB-009)', () => {
  it('classifyError is total: any thrown value becomes a TranRequestError (REQ-ROB-005)', () => {
    fc.assert(
      fc.property(
        fc.anything({ withBigInt: true, withNullPrototype: true, withMap: true }),
        (v) => {
          expect(classifyError(v)).toBeInstanceOf(TranRequestError);
        }
      )
    );
  });

  it('every retry delay lies in [half, 2 × half] and never exceeds the maximum', () => {
    // Edge values on purpose: fc.double() draws NaN about once in a thousand.
    const edges = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    fc.assert(
      fc.property(fc.oneof(fc.integer(), edges), fc.oneof(fc.double(), edges), (retry, random) => {
        const step = Number.isNaN(retry) ? 0 : Math.min(Math.max(retry - 1, 0), 16);
        const exponential = RETRY_POLICY.baseDelayMs * 2 ** step;
        const half = Math.floor(Math.min(exponential, RETRY_POLICY.maxDelayMs) / 2);
        const delay = retryDelayMs(retry, random);
        expect(Number.isInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(half);
        expect(delay).toBeLessThanOrEqual(Math.min(2 * half, RETRY_POLICY.maxDelayMs));
      })
    );
  });

  it('a NaN jitter means no jitter, as in Rust (`f64::clamp` then `as u64`)', () => {
    expect(retryDelayMs(1, Number.NaN)).toBe(retryDelayMs(1, 0));
    expect(retryDelayMs(Number.NaN, 0.5)).toBe(retryDelayMs(1, 0.5));
  });

  it('Retry-After never exceeds the maximum', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.stringMatching(/^\d{1,25}$/)), (header) => {
        const ms = retryAfterMs(header);
        if (ms !== null) expect(ms).toBeLessThanOrEqual(RETRY_POLICY.maxDelayMs);
      })
    );
  });

  it('age is zero on the birthdate and never decreases as time passes', () => {
    fc.assert(
      fc.property(isoDate, isoDate, isoDate, (birth, a, b) => {
        const [earlier, later] = a <= b ? [a, b] : [b, a];
        expect(ageFromBirthdate(birth, birth)).toBe(0);
        expect(ageFromBirthdate(birth, earlier)).toBeLessThanOrEqual(
          ageFromBirthdate(birth, later)
        );
      })
    );
  });

  it('an accepted evaluation never reports an age above the maximum (REQ-ROB-001)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: 0, max: MAX_AGE }), fc.integer()),
        fc.option(isoDate, { nil: undefined }),
        (age, birthdate) => {
          try {
            const result = evaluateVoteEligibilityOffline({
              age,
              birthdate,
              countryCode: 'US',
              referenceDate: '2026-10-18',
            });
            expect(result.age).toBeLessThanOrEqual(MAX_AGE);
            expect(result.age).toBeGreaterThanOrEqual(0);
          } catch (err) {
            expect(err).toBeInstanceOf(VoteEligibilityValidationError);
          }
        }
      )
    );
  });

  it('parseAgeInput yields null or a whole number of years within range', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.stringMatching(/^\s*\d{1,5}\s*$/)), (raw) => {
        const age = parseAgeInput(raw);
        if (age !== null) {
          expect(Number.isInteger(age)).toBe(true);
          expect(age).toBeGreaterThanOrEqual(0);
          expect(age).toBeLessThanOrEqual(MAX_AGE);
        }
      })
    );
  });

  it('a valid request id is short and inert', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 70 }), fc.stringMatching(/^[A-Za-z0-9._-]{1,64}$/)),
        (id) => {
          if (isValidRequestId(id)) {
            expect(id.length).toBeGreaterThan(0);
            expect(id.length).toBeLessThanOrEqual(64);
            expect(id).not.toMatch(/[\s"'<>;\\]/);
          }
        }
      )
    );
  });
});
