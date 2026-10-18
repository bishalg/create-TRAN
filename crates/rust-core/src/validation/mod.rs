use crate::error::{CoreError, CoreResult};
use crate::models::CalculationRequest;

pub fn validate_calculation_request(req: &CalculationRequest) -> CoreResult<()> {
    if req.operation.is_empty() {
        return Err(CoreError::ValidationError(
            "Operation cannot be empty".to_string(),
        ));
    }

    match req.operation.as_str() {
        "add" | "subtract" | "multiply" => Ok(()),
        "divide" => {
            if req.b == 0.0 {
                Err(CoreError::ValidationError(
                    "Division by zero is not allowed".to_string(),
                ))
            } else {
                Ok(())
            }
        }
        "power" => {
            if req.a < 0.0 && req.b.fract() != 0.0 {
                Err(CoreError::ValidationError(
                    "Cannot raise negative number to fractional power".to_string(),
                ))
            } else {
                Ok(())
            }
        }
        unknown => Err(CoreError::ValidationError(format!(
            "Unsupported operation: '{}'. Supported: add, subtract, multiply, divide, power",
            unknown
        ))),
    }
}
