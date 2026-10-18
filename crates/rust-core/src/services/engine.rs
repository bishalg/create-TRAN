use chrono::Utc;
use std::time::Instant;
use uuid::Uuid;

use crate::error::{CoreError, CoreResult};
use crate::models::{
    CalculationRequest, CalculationResponse, StackComponentStatus, StackLayer, TranHealthReport,
};
use crate::models::VoteEligibilityRequest;
use crate::models::VoteEligibilityResponse;
use crate::validation::validate_calculation_request;
use crate::validation::validate_vote_eligibility_request;
use crate::voting::{
    age_from_birthdate, can_vote_by_age, voting_age_for_country,
};

#[derive(Debug, Default, Clone)]
pub struct TranEngine;

impl TranEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn compute(&self, request: CalculationRequest) -> CoreResult<CalculationResponse> {
        validate_calculation_request(&request)?;

        let start = Instant::now();
        let result = match request.operation.as_str() {
            "add" => request.a + request.b,
            "subtract" => request.a - request.b,
            "multiply" => request.a * request.b,
            "divide" => request.a / request.b,
            "power" => request.a.powf(request.b),
            _ => {
                return Err(CoreError::ExecutionError(format!(
                    "Unreachable operation {}",
                    request.operation
                )))
            }
        };

        let elapsed = start.elapsed().as_micros() as u64;

        Ok(CalculationResponse {
            calculation_id: Uuid::new_v4(),
            result,
            computed_at: Utc::now(),
            execution_micros: elapsed,
        })
    }

    pub fn evaluate_vote_eligibility(
        &self,
        request: VoteEligibilityRequest,
        country_code: &str,
        country_source: &str,
        client_ip: &str,
    ) -> CoreResult<VoteEligibilityResponse> {
        validate_vote_eligibility_request(&request)?;

        let today = Utc::now().date_naive();
        let age = request
            .birthdate
            .map(|bd| age_from_birthdate(bd, today))
            .unwrap_or(request.age);

        let minimum_age = voting_age_for_country(country_code);
        let eligible = can_vote_by_age(age, minimum_age);

        let reason = if eligible {
            format!(
                "Age {age} meets the minimum voting age of {minimum_age} in {country_code}."
            )
        } else {
            format!(
                "Age {age} is below the minimum voting age of {minimum_age} in {country_code}."
            )
        };

        Ok(VoteEligibilityResponse {
            eligibility_id: Uuid::new_v4(),
            eligible,
            age,
            minimum_age,
            country_code: country_code.to_uppercase(),
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
