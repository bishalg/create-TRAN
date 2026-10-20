use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use uuid::Uuid;

use crate::error::CoreResult;
use crate::models::VoteEligibilityRequest;
use crate::models::VoteEligibilityResponse;
use crate::models::{StackComponentStatus, StackLayer, TranHealthReport};
use crate::validation::{validate_country_code, validate_vote_eligibility_request};
use crate::voting::{age_from_birthdate, can_vote_by_age, voting_age_for_country};

#[derive(Debug, Default, Clone)]
pub struct TranEngine;

impl TranEngine {
    pub fn new() -> Self {
        Self
    }

    /// Evaluates eligibility at the current instant, read once (REQ-ROB-011). Prefer
    /// [`Self::evaluate_vote_eligibility_at`] in tests so results do not depend on the clock.
    pub fn evaluate_vote_eligibility(
        &self,
        request: VoteEligibilityRequest,
        country_code: &str,
        country_source: &str,
        client_ip: &str,
    ) -> CoreResult<VoteEligibilityResponse> {
        self.evaluate_vote_eligibility_at(
            request,
            country_code,
            country_source,
            client_ip,
            Utc::now(),
        )
    }

    /// Evaluates as of midnight UTC on `today` — for callers that only have a date (offline FFI,
    /// golden fixtures).
    pub fn evaluate_vote_eligibility_on(
        &self,
        request: VoteEligibilityRequest,
        country_code: &str,
        country_source: &str,
        client_ip: &str,
        today: NaiveDate,
    ) -> CoreResult<VoteEligibilityResponse> {
        self.evaluate_vote_eligibility_at(
            request,
            country_code,
            country_source,
            client_ip,
            today.and_time(NaiveTime::MIN).and_utc(),
        )
    }

    /// Deterministic core of the eligibility rules: `now` is injected, never read from a clock, and
    /// both the age and `evaluated_at` come from it (REQ-ROB-011).
    pub fn evaluate_vote_eligibility_at(
        &self,
        request: VoteEligibilityRequest,
        country_code: &str,
        country_source: &str,
        client_ip: &str,
        now: DateTime<Utc>,
    ) -> CoreResult<VoteEligibilityResponse> {
        let today = now.date_naive();
        validate_vote_eligibility_request(&request, today)?;
        validate_country_code(country_code)?;

        let country_code = country_code.to_uppercase();
        let age = request
            .birthdate
            .map(|bd| age_from_birthdate(bd, today))
            .unwrap_or(request.age);

        let minimum_age = voting_age_for_country(&country_code);
        let eligible = can_vote_by_age(age, minimum_age);

        let reason = if eligible {
            format!("Age {age} meets the minimum voting age of {minimum_age} in {country_code}.")
        } else {
            format!("Age {age} is below the minimum voting age of {minimum_age} in {country_code}.")
        };

        Ok(VoteEligibilityResponse {
            eligibility_id: Uuid::new_v4(),
            eligible,
            age,
            minimum_age,
            country_code,
            country_source: country_source.to_string(),
            client_ip: client_ip.to_string(),
            reason,
            evaluated_at: now,
        })
    }

    /// Reports only what the server can observe: this crate and the API binary that embeds it.
    /// `api_version` is the caller's own crate version (`env!("CARGO_PKG_VERSION")`).
    pub fn generate_health_report(
        &self,
        uptime_seconds: u64,
        api_version: &str,
    ) -> TranHealthReport {
        let component = |layer, name: &str, version: &str| StackComponentStatus {
            layer,
            name: name.to_string(),
            version: version.to_string(),
            healthy: true,
            uptime_seconds,
        };
        let components = vec![
            component(StackLayer::RustCore, "rust-core", env!("CARGO_PKG_VERSION")),
            component(StackLayer::AxumApi, "axum-api", api_version),
        ];

        TranHealthReport {
            report_id: Uuid::new_v4(),
            timestamp: Utc::now(),
            overall_status: "HEALTHY".to_string(),
            components,
        }
    }
}
