/**
 * TypeScript mirror of `crates/rust-core/src/voting.rs`.
 * Keep rules in sync — parity tests assert the same cases as Rust unit tests.
 */

export const DEFAULT_VOTING_AGE = 18;

const COUNTRY_VOTING_AGES: Record<string, number> = {
  US: 18,
  IN: 18,
  NP: 18,
  GB: 18,
  DE: 18,
  FR: 18,
  BR: 16,
};

export function votingAgeForCountry(countryCode: string): number {
  const upper = countryCode.toUpperCase();
  return COUNTRY_VOTING_AGES[upper] ?? DEFAULT_VOTING_AGE;
}

export function canVoteByAge(age: number, minimumAge: number): boolean {
  return age >= minimumAge;
}

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
  const [y, m, d] = iso.split('-').map((part) => Number(part));
  return new Date(Date.UTC(y, m - 1, d));
}

export interface OfflineEligibilityInput {
  age: number;
  countryCode: string;
  birthdate?: string;
  referenceDate?: string;
}

export interface OfflineEligibilityResult {
  eligible: boolean;
  age: number;
  minimumAge: number;
  countryCode: string;
  reason: string;
}

export function evaluateVoteEligibilityOffline(
  input: OfflineEligibilityInput
): OfflineEligibilityResult {
  const countryCode = input.countryCode.toUpperCase();
  const minimumAge = votingAgeForCountry(countryCode);
  const reference = input.referenceDate ?? new Date().toISOString().slice(0, 10);
  const age =
    input.birthdate !== undefined
      ? ageFromBirthdate(input.birthdate, reference)
      : input.age;
  const eligible = canVoteByAge(age, minimumAge);
  const reason = eligible
    ? `Age ${age} meets the minimum voting age of ${minimumAge} in ${countryCode}.`
    : `Age ${age} is below the minimum voting age of ${minimumAge} in ${countryCode}.`;

  return { eligible, age, minimumAge, countryCode, reason };
}
