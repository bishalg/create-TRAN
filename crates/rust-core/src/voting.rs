//! Voting eligibility rules — source of truth for web/native offline mirrors.
//! After edits: `cargo test -p rust-core` and sync `packages/core-ts/src/voting.ts`.

use chrono::{Datelike, NaiveDate};

pub const DEFAULT_VOTING_AGE: u16 = 18;

/// Returns the minimum voting age for a country (ISO 3166-1 alpha-2).
pub fn voting_age_for_country(country_code: &str) -> u16 {
    match country_code.to_uppercase().as_str() {
        "US" | "IN" | "NP" | "GB" | "DE" | "FR" => 18,
        "BR" => 16,
        _ => DEFAULT_VOTING_AGE,
    }
}

/// Whether `age` meets the minimum voting age for a jurisdiction.
pub fn can_vote_by_age(age: u16, minimum_age: u16) -> bool {
    age >= minimum_age
}

/// Whole years between birth date and reference date (birthday not yet reached → age - 1).
pub fn age_from_birthdate(birthdate: NaiveDate, reference: NaiveDate) -> u16 {
    if birthdate > reference {
        return 0;
    }

    let years = reference.year() - birthdate.year();
    let birthday_passed =
        (reference.month(), reference.day()) >= (birthdate.month(), birthdate.day());
    let age = if birthday_passed { years } else { years - 1 };
    age.max(0) as u16
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

    #[test]
    fn age_from_birthdate_leap_day_counts_as_passed_on_march_first() {
        let birth = NaiveDate::from_ymd_opt(2004, 2, 29).unwrap();
        let day_before = NaiveDate::from_ymd_opt(2022, 2, 28).unwrap();
        let march_first = NaiveDate::from_ymd_opt(2022, 3, 1).unwrap();
        assert_eq!(age_from_birthdate(birth, day_before), 17);
        assert_eq!(age_from_birthdate(birth, march_first), 18);
    }

    #[test]
    fn voting_age_is_case_insensitive() {
        assert_eq!(voting_age_for_country("br"), voting_age_for_country("BR"));
    }
}
