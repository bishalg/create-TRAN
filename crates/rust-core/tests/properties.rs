// Verifies: REQ-ROB-009 REQ-ROB-001
//! Invariants over generated input — the cases nobody writes an example for. Failures shrink to a
//! minimal counter-example; add it to `fixtures/` as a golden row when it reveals a bug.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use chrono::NaiveDate;
use proptest::prelude::*;
use rust_core::feedback::{is_valid_request_id, retry_after_ms, retry_delay_ms, RETRY_POLICY};
use rust_core::{
    age_from_birthdate, parse_iso_date, validate_country_code_format, validate_vote_eligibility,
    TranEngine, VoteEligibilityRequest, VoteValidationError, MAX_AGE,
};

/// Any date chrono can represent, not just plausible birthdays.
fn any_date() -> impl Strategy<Value = NaiveDate> {
    (-262_000i32..=262_000, 1u32..=12, 1u32..=31)
        .prop_filter_map("a real calendar day", |(y, m, d)| {
            NaiveDate::from_ymd_opt(y, m, d)
        })
}

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 18).unwrap()
}

proptest! {
    #[test]
    fn age_on_the_birthdate_is_zero(birth in any_date()) {
        prop_assert_eq!(age_from_birthdate(birth, birth), 0);
    }

    #[test]
    fn age_never_decreases_as_time_passes(birth in any_date(), a in any_date(), b in any_date()) {
        let (earlier, later) = if a <= b { (a, b) } else { (b, a) };
        prop_assert!(age_from_birthdate(birth, earlier) <= age_from_birthdate(birth, later));
    }

    #[test]
    fn an_accepted_request_never_yields_an_age_above_the_maximum(
        // Mostly valid ages, so the birthdate path is what gets exercised.
        age in prop_oneof![4 => 0..=MAX_AGE, 1 => any::<u16>()],
        birth in proptest::option::of(any_date()),
    ) {
        let request = VoteEligibilityRequest { age, birthdate: birth };
        match TranEngine::new().evaluate_vote_eligibility_on(request.clone(), "US", "p", "ip", today()) {
            Ok(response) => prop_assert!(response.age <= MAX_AGE, "{response:?}"),
            Err(_) => prop_assert!(validate_vote_eligibility(&request, today()).is_err()),
        }
    }

    #[test]
    fn a_birthdate_out_of_range_is_rejected_as_age_not_wrapped(birth in any_date()) {
        prop_assume!(birth <= today() && age_from_birthdate(birth, today()) > MAX_AGE);
        let request = VoteEligibilityRequest { age: 20, birthdate: Some(birth) };
        prop_assert_eq!(
            validate_vote_eligibility(&request, today()),
            Err(VoteValidationError::AgeOutOfRange)
        );
    }

    #[test]
    fn country_codes_are_exactly_two_ascii_letters(code in "\\PC{0,4}|[A-Za-z]{2}") {
        let expected = code.len() == 2 && code.bytes().all(|b| b.is_ascii_alphabetic());
        prop_assert_eq!(validate_country_code_format(&code).is_ok(), expected, "{:?}", code);
    }

    #[test]
    fn iso_dates_round_trip_exactly(raw in "\\PC{0,12}|[0-9]{4}-[0-9]{2}-[0-9]{2}") {
        if let Some(date) = parse_iso_date(&raw) {
            prop_assert_eq!(date.format("%Y-%m-%d").to_string(), raw);
        }
    }

    #[test]
    fn retry_delays_stay_inside_the_jitter_window(retry in any::<u32>(), random in any::<f64>()) {
        let delay = retry_delay_ms(retry, random);
        let exponential = RETRY_POLICY
            .base_delay_ms
            .saturating_mul(1u64 << retry.saturating_sub(1).min(16));
        let half = exponential.min(RETRY_POLICY.max_delay_ms) / 2;
        prop_assert!(delay >= half && delay <= 2 * half, "{delay} not in [{half}, {}]", 2 * half);
        prop_assert!(delay <= RETRY_POLICY.max_delay_ms);
    }

    #[test]
    fn retry_after_is_digits_only_and_never_exceeds_the_maximum(
        header in "\\PC{0,24}|[+-]?[0-9]{1,25}"
    ) {
        let trimmed = header.trim();
        let digits = !trimmed.is_empty() && trimmed.bytes().all(|b| b.is_ascii_digit());
        prop_assert_eq!(retry_after_ms(&header).is_some(), digits, "{:?}", header);
        if let Some(ms) = retry_after_ms(&header) {
            prop_assert!(ms <= RETRY_POLICY.max_delay_ms);
        }
    }

    #[test]
    fn a_valid_request_id_is_inert(id in "\\PC{0,70}|[A-Za-z0-9._-]{1,64}") {
        if is_valid_request_id(&id) {
            prop_assert!(id.len() <= 64 && !id.is_empty());
            prop_assert!(id.bytes().all(|b| b.is_ascii_graphic() && !b"\"'<>;\\".contains(&b)));
        }
    }
}
