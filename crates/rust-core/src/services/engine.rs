use chrono::{NaiveDate, Utc};
use std::time::Instant;
use uuid::Uuid;

use crate::error::{CoreError, CoreResult};
use crate::models::VoteEligibilityRequest;
use crate::models::VoteEligibilityResponse;
use crate::models::{
    CalculationRequest, CalculationResponse, StackComponentStatus, StackLayer, TranHealthReport,
};
use crate::validation::validate_calculation_request;
use crate::validation::{validate_country_code, validate_vote_eligibility_request};
use crate::voting::{age_from_birthdate, can_vote_by_age, voting_age_for_country};

fn apply_operation(operation: &str, a: f64, b: f64) -> CoreResult<f64> {
    match operation {
        "add" => Ok(a + b),
        "subtract" => Ok(a - b),
        "multiply" => Ok(a * b),
        "divide" => Ok(a / b),
        "power" => Ok(a.powf(b)),
        other => Err(CoreError::ExecutionError(format!(
            "Unreachable operation {other}"
        ))),
    }
}

#[derive(Debug, Default, Clone)]
pub struct TranEngine;

impl TranEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn compute(&self, request: CalculationRequest) -> CoreResult<CalculationResponse> {
        validate_calculation_request(&request)?;

        let start = Instant::now();
        let result = apply_operation(&request.operation, request.a, request.b)?;

        let elapsed = start.elapsed().as_micros() as u64;

        Ok(CalculationResponse {
            calculation_id: Uuid::new_v4(),
            result,
            computed_at: Utc::now(),
            execution_micros: elapsed,
        })
    }

    /// Evaluates eligibility using the current UTC date. Prefer
    /// [`Self::evaluate_vote_eligibility_on`] in tests so results do not depend on the clock.
    pub fn evaluate_vote_eligibility(
        &self,
        request: VoteEligibilityRequest,
        country_code: &str,
        country_source: &str,
        client_ip: &str,
    ) -> CoreResult<VoteEligibilityResponse> {
        self.evaluate_vote_eligibility_on(
            request,
            country_code,
            country_source,
            client_ip,
            Utc::now().date_naive(),
        )
    }

    /// Deterministic core of the eligibility rules: `today` is injected, never read from a clock.
    pub fn evaluate_vote_eligibility_on(
        &self,
        request: VoteEligibilityRequest,
        country_code: &str,
        country_source: &str,
        client_ip: &str,
        today: NaiveDate,
    ) -> CoreResult<VoteEligibilityResponse> {
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
            evaluated_at: Utc::now(),
        })
    }

    pub fn generate_health_report(&self, uptime_seconds: u64) -> TranHealthReport {
        let components = vec![
            StackComponentStatus {
                layer: StackLayer::TanStackStart,
                name: "TanStack Start Web App".to_string(),
                version: "1.0.0".to_string(),
                healthy: true,
                uptime_seconds,
            },
            StackComponentStatus {
                layer: StackLayer::RustCore,
                name: "Rust Domain Core".to_string(),
                version: "0.1.0".to_string(),
                healthy: true,
                uptime_seconds,
            },
            StackComponentStatus {
                layer: StackLayer::AxumApi,
                name: "Axum Microservice".to_string(),
                version: "0.8.0".to_string(),
                healthy: true,
                uptime_seconds,
            },
            StackComponentStatus {
                layer: StackLayer::NativeMobile,
                name: "Native Mobile (iOS/Android)".to_string(),
                version: "1.0.0".to_string(),
                healthy: true,
                uptime_seconds,
            },
        ];

        TranHealthReport {
            report_id: Uuid::new_v4(),
            timestamp: Utc::now(),
            overall_status: "HEALTHY".to_string(),
            components,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_operation_rejects_operations_validation_should_have_caught() {
        assert!(matches!(
            apply_operation("modulo", 1.0, 2.0),
            Err(CoreError::ExecutionError(_))
        ));
    }
}
