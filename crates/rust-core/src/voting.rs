//! Voting eligibility rules — source of truth for web/native offline mirrors.
//! After edits: `cargo test -p rust-core`, then `pnpm tokens:sync` regenerates the TypeScript rule data.

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

pub const DEFAULT_VOTING_AGE: u16 = 18;

/// One row of the supported-country table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CountryVotingAge {
    pub country_code: &'static str,
    pub minimum_age: u16,
}

/// Supported countries (ISO 3166-1 alpha-2), sorted by code. The only table behind
/// [`voting_age_for_country`]; TypeScript and native read it through codegen and UniFFI.
pub const SUPPORTED_COUNTRIES: &[CountryVotingAge] = &[
    CountryVotingAge {
        country_code: "BR",
        minimum_age: 16,
    },
    CountryVotingAge {
        country_code: "DE",
        minimum_age: 18,
    },
    CountryVotingAge {
        country_code: "FR",
        minimum_age: 18,
    },
    CountryVotingAge {
        country_code: "GB",
        minimum_age: 18,
    },
    CountryVotingAge {
        country_code: "IN",
        minimum_age: 18,
    },
    CountryVotingAge {
        country_code: "NP",
        minimum_age: 18,
    },
    CountryVotingAge {
        country_code: "US",
        minimum_age: 18,
    },
];

/// Returns the minimum voting age for a country (ISO 3166-1 alpha-2, case-insensitive).
/// Well-formed codes that are not supported fall back to [`DEFAULT_VOTING_AGE`].
pub fn voting_age_for_country(country_code: &str) -> u16 {
    SUPPORTED_COUNTRIES
        .iter()
        .find(|c| c.country_code.eq_ignore_ascii_case(country_code))
        .map_or(DEFAULT_VOTING_AGE, |c| c.minimum_age)
}

/// Whether `age` meets the minimum voting age for a jurisdiction.
pub fn can_vote_by_age(age: u16, minimum_age: u16) -> bool {
    age >= minimum_age
}

/// Parses exactly `YYYY-MM-DD` (ISO 8601 calendar date, four-digit year). chrono alone also accepts
/// signed and five-digit years (`-0001-01-01`, `+002000-01-01`); the TypeScript and native clients
/// do not, so neither does the core (REQ-ROB-001).
pub fn parse_iso_date(raw: &str) -> Option<NaiveDate> {
    let well_formed = raw.len() == 10
        && raw.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !well_formed {
        return None;
    }
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()
}

/// Whole years between birth date and reference date (birthday not yet reached → age - 1).
pub fn age_from_birthdate(birthdate: NaiveDate, reference: NaiveDate) -> u16 {
    let years = reference.year() - birthdate.year();
    let birthday_passed =
        (reference.month(), reference.day()) >= (birthdate.month(), birthdate.day());
    let age = if birthday_passed { years } else { years - 1 };
    // A future birthdate is age 0 (validation rejects it separately). chrono spans ±262 143 years:
    // saturate instead of wrapping (`as u16`) so an absurd birthdate stays absurd and the
    // `MAX_AGE` check rejects it (REQ-ROB-001).
    u16::try_from(age.max(0)).unwrap_or(u16::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn voting_ages_by_country() {
        assert_eq!(voting_age_for_country("us"), 18);
        assert_eq!(voting_age_for_country("BR"), 16);
        assert_eq!(voting_age_for_country("XX"), DEFAULT_VOTING_AGE);
    }

    #[test]
    fn can_vote_by_age_boundary() {
        assert!(!can_vote_by_age(17, 18));
        assert!(can_vote_by_age(18, 18));
        assert!(can_vote_by_age(25, 18));
    }

    #[test]
    fn age_from_birthdate_before_birthday() {
        let birth = NaiveDate::from_ymd_opt(2000, 6, 15).unwrap();
        let ref_date = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert_eq!(age_from_birthdate(birth, ref_date), 25);
    }

    #[test]
    fn age_from_birthdate_on_birthday() {
        let birth = NaiveDate::from_ymd_opt(2000, 6, 15).unwrap();
        let ref_date = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        assert_eq!(age_from_birthdate(birth, ref_date), 26);
    }

    #[test]
    fn age_from_birthdate_future_birthdate_is_zero() {
        let birth = NaiveDate::from_ymd_opt(2030, 1, 1).unwrap();
        let ref_date = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
        assert_eq!(age_from_birthdate(birth, ref_date), 0);
    }

    // Verifies: REQ-ROB-001
    #[test]
    fn age_from_birthdate_saturates_instead_of_wrapping() {
        let ancient = NaiveDate::from_ymd_opt(-262_000, 1, 1).unwrap();
        let ref_date = NaiveDate::from_ymd_opt(2026, 10, 18).unwrap();
        assert_eq!(age_from_birthdate(ancient, ref_date), u16::MAX);
    }

    #[test]
    fn age_from_birthdate_leap_day_counts_as_passed_on_march_first() {
        let birth = NaiveDate::from_ymd_opt(2004, 2, 29).unwrap();
        let day_before = NaiveDate::from_ymd_opt(2022, 2, 28).unwrap();
        let march_first = NaiveDate::from_ymd_opt(2022, 3, 1).unwrap();
        assert_eq!(age_from_birthdate(birth, day_before), 17);
        assert_eq!(age_from_birthdate(birth, march_first), 18);
    }

    // Verifies: REQ-RULE-009
    #[test]
    fn supported_countries_are_unique_upper_case_and_sorted() {
        let codes: Vec<&str> = SUPPORTED_COUNTRIES.iter().map(|c| c.country_code).collect();
        assert!(codes.windows(2).all(|pair| pair[0] < pair[1]), "{codes:?}");
        assert!(codes
            .iter()
            .all(|code| code.len() == 2 && code.bytes().all(|b| b.is_ascii_uppercase())));
    }

    // Verifies: REQ-ROB-001
    #[test]
    fn parse_iso_date_accepts_only_four_digit_calendar_dates() {
        assert_eq!(
            parse_iso_date("0001-01-01"),
            NaiveDate::from_ymd_opt(1, 1, 1)
        );
        assert_eq!(
            parse_iso_date("2024-02-29"),
            NaiveDate::from_ymd_opt(2024, 2, 29)
        );
        for raw in [
            "2023-02-29",
            "-001-01-01",
            "+2000-0101",
            "2000/01/01",
            "２０００-01-01",
        ] {
            assert_eq!(parse_iso_date(raw), None, "{raw}");
        }
    }

    #[test]
    fn voting_age_is_case_insensitive() {
        assert_eq!(voting_age_for_country("br"), voting_age_for_country("BR"));
    }
}
