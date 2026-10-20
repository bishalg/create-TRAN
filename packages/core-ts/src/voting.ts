/**
 * TypeScript logic over rule data generated from `crates/rust-core` (`./generated/rules.ts`).
 * Never hand-edit a table or message here: change Rust, run `pnpm tokens:sync`. The functions below
 * are pinned to Rust by `fixtures/vote-eligibility.json` (parity tests).
 */

import {
  DEFAULT_VOTING_AGE,
  MAX_AGE,
  SUPPORTED_COUNTRIES,
  VALIDATION_MESSAGES,
} from './generated/rules.js';
import type { ErrorCode } from './generated/feedback.js';

export { DEFAULT_VOTING_AGE, MAX_AGE, SUPPORTED_COUNTRIES, VALIDATION_MESSAGES };
export type { CountryVotingAge } from './generated/rules.js';

export function votingAgeForCountry(countryCode: string): number {
  const upper = countryCode.toUpperCase();
  return SUPPORTED_COUNTRIES.find((c) => c.countryCode === upper)?.minimumAge ?? DEFAULT_VOTING_AGE;
}

export function canVoteByAge(age: number, minimumAge: number): boolean {
  return age >= minimumAge;
}

/** Mirrors `CoreError::ValidationError` in Rust; the API maps the same condition to HTTP 400.
 * `code` is the catalogue code the UI presents (REQ-ERR-001); `message` is for logs only. */
export class VoteEligibilityValidationError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode
  ) {
    super(message);
    this.name = 'VoteEligibilityValidationError';
  }
}

/** Whole years between two ISO dates. Throws on malformed or impossible dates (e.g. 2000-02-30). */
export function ageFromBirthdate(birthdateIso: string, referenceIso: string): number {
  const birth = parseIsoDate(birthdateIso);
  const reference = parseIsoDate(referenceIso);
  let years = reference.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed =
    reference.getUTCMonth() > birth.getUTCMonth() ||
    (reference.getUTCMonth() === birth.getUTCMonth() &&
      reference.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) years -= 1;
  return Math.max(0, years);
}

function parseIsoDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match)
    throw new VoteEligibilityValidationError(
      `Invalid ISO date: ${JSON.stringify(iso)}`,
      'validation.invalid_date'
    );
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Not `Date.UTC(y, …)`: it maps years 0–99 to 1900–1999, so 0001-01-01 would become 1901.
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  // Out-of-range parts roll over (2000-02-30 → March 1st, 2000-13-01 → January). With two-digit
  // parts every rollover lands in another month, so the month alone detects it.
  if (date.getUTCMonth() !== m - 1) {
    throw new VoteEligibilityValidationError(
      `Invalid ISO date: ${JSON.stringify(iso)}`,
      'validation.invalid_date'
    );
  }
  return date;
}

export interface OfflineEligibilityInput {
  age: number;
  countryCode: string;
  birthdate?: string;
  /** ISO date used as "today"; inject it in tests so results never depend on the clock. */
  referenceDate?: string;
}

export interface OfflineEligibilityResult {
  eligible: boolean;
  age: number;
  minimumAge: number;
  countryCode: string;
  reason: string;
}

/** Same checks as `validate_vote_eligibility_request` + `validate_country_code` in Rust. */
function validateInput(input: OfflineEligibilityInput, reference: string): void {
  if (!Number.isInteger(input.age) || input.age < 0) {
    throw new VoteEligibilityValidationError(
      'Age must be a whole number of years, 0 or more',
      'validation.age_out_of_range'
    );
  }
  if (input.age > MAX_AGE) {
    throw new VoteEligibilityValidationError(
      VALIDATION_MESSAGES.ageOutOfRange,
      'validation.age_out_of_range'
    );
  }
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    throw new VoteEligibilityValidationError(
      VALIDATION_MESSAGES.invalidCountryCode,
      'validation.invalid_country_code'
    );
  }
  if (input.birthdate !== undefined) {
    if (parseIsoDate(input.birthdate) > parseIsoDate(reference)) {
      throw new VoteEligibilityValidationError(
        VALIDATION_MESSAGES.birthdateInFuture,
        'validation.birthdate_in_future'
      );
    }
    // The derived age replaces `age`, so it must pass the same limit (REQ-ROB-001).
    if (ageFromBirthdate(input.birthdate, reference) > MAX_AGE) {
      throw new VoteEligibilityValidationError(
        VALIDATION_MESSAGES.ageOutOfRange,
        'validation.age_out_of_range'
      );
    }
  }
}

export function evaluateVoteEligibilityOffline(
  input: OfflineEligibilityInput
): OfflineEligibilityResult {
  const reference = input.referenceDate ?? new Date().toISOString().slice(0, 10);
  validateInput(input, reference);

  const countryCode = input.countryCode.toUpperCase();
  const minimumAge = votingAgeForCountry(countryCode);
  const age =
    input.birthdate !== undefined ? ageFromBirthdate(input.birthdate, reference) : input.age;
  const eligible = canVoteByAge(age, minimumAge);
  const reason = eligible
    ? `Age ${age} meets the minimum voting age of ${minimumAge} in ${countryCode}.`
    : `Age ${age} is below the minimum voting age of ${minimumAge} in ${countryCode}.`;

  return { eligible, age, minimumAge, countryCode, reason };
}

/**
 * Strict form-field parser: whole numbers 0..150 only. Returns `null` instead of silently
 * truncating ("21abc" -> 21) or coercing blanks to 0 like `parseInt`/`Number` would.
 */
export function parseAgeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const age = Number(trimmed);
  return age <= MAX_AGE ? age : null;
}
