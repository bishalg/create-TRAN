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

export { DEFAULT_VOTING_AGE, MAX_AGE, SUPPORTED_COUNTRIES, VALIDATION_MESSAGES };
export type { CountryVotingAge } from './generated/rules.js';

export function votingAgeForCountry(countryCode: string): number {
  const upper = countryCode.toUpperCase();
  return SUPPORTED_COUNTRIES.find((c) => c.countryCode === upper)?.minimumAge ?? DEFAULT_VOTING_AGE;
}

export function canVoteByAge(age: number, minimumAge: number): boolean {
  return age >= minimumAge;
}

/** Mirrors `CoreError::ValidationError` in Rust; the API maps the same condition to HTTP 400. */
export class VoteEligibilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoteEligibilityValidationError';
  }
}

/** Whole years between two ISO dates. Throws on malformed or impossible dates (e.g. 2000-02-30). */
export function ageFromBirthdate(birthdateIso: string, referenceIso: string): number {
  const birth = parseIsoDate(birthdateIso);
  const reference = parseIsoDate(referenceIso);
  if (birth > reference) return 0;

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
  if (!match) throw new VoteEligibilityValidationError(`Invalid ISO date: "${iso}"`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC silently rolls 2000-02-30 over to March 1st; round-trip to detect that.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new VoteEligibilityValidationError(`Invalid ISO date: "${iso}"`);
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
    throw new VoteEligibilityValidationError('Age must be a whole number of years, 0 or more');
  }
  if (input.age > MAX_AGE) {
    throw new VoteEligibilityValidationError(VALIDATION_MESSAGES.ageOutOfRange);
  }
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    throw new VoteEligibilityValidationError(VALIDATION_MESSAGES.invalidCountryCode);
  }
  if (input.birthdate !== undefined && parseIsoDate(input.birthdate) > parseIsoDate(reference)) {
    throw new VoteEligibilityValidationError(VALIDATION_MESSAGES.birthdateInFuture);
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
