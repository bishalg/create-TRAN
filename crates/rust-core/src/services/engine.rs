use chrono::Utc;
use std::time::Instant;
use uuid::Uuid;

use crate::error::{CoreError, CoreResult};
use crate::models::{
    CalculationRequest, CalculationResponse, StackComponentStatus, StackLayer, TranHealthReport,
};
use crate::validation::validate_calculation_request;

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
