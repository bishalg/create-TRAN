use rust_core::{
    validate_calculation_request, CalculationRequest, CoreError, StackLayer, TranEngine,
};

#[test]
fn test_stack_layers_metadata() {
    assert_eq!(StackLayer::TanStackStart.code(), 'T');
    assert_eq!(StackLayer::RustCore.code(), 'R');
    assert_eq!(StackLayer::AxumApi.code(), 'A');
    assert_eq!(StackLayer::NativeMobile.code(), 'N');

    assert!(StackLayer::TanStackStart
        .display_name()
        .contains("TanStack"));
    assert!(StackLayer::RustCore.display_name().contains("Rust Core"));
    assert!(StackLayer::AxumApi.display_name().contains("Axum"));
    assert!(StackLayer::NativeMobile
        .display_name()
        .contains("Native Mobile"));
}

#[test]
fn test_engine_add_computation() {
    let engine = TranEngine::new();
    let req = CalculationRequest {
        a: 10.0,
        b: 25.5,
        operation: "add".to_string(),
    };

    let res = engine.compute(req).expect("Failed to compute addition");
    assert_eq!(res.result, 35.5);
}

#[test]
fn test_engine_multiply_computation() {
    let engine = TranEngine::new();
    let req = CalculationRequest {
        a: 6.0,
        b: 7.0,
        operation: "multiply".to_string(),
    };

    let res = engine
        .compute(req)
        .expect("Failed to compute multiplication");
    assert_eq!(res.result, 42.0);
}

#[test]
fn test_engine_division_by_zero_fails() {
    let engine = TranEngine::new();
    let req = CalculationRequest {
        a: 100.0,
        b: 0.0,
        operation: "divide".to_string(),
    };

    let err = engine
        .compute(req)
        .expect_err("Should error on divide by zero");
    assert_eq!(
        err,
        CoreError::ValidationError("Division by zero is not allowed".to_string())
    );
}

#[test]
fn test_validation_unsupported_operation() {
    let req = CalculationRequest {
        a: 5.0,
        b: 5.0,
        operation: "modulo".to_string(),
    };

    let err = validate_calculation_request(&req).expect_err("Should reject unsupported op");
    match err {
        CoreError::ValidationError(msg) => {
            assert!(msg.contains("Unsupported operation"));
        }
        _ => panic!("Expected ValidationError"),
    }
}

#[test]
fn test_engine_generate_health_report() {
    let engine = TranEngine::new();
    let report = engine.generate_health_report(120);

    assert_eq!(report.overall_status, "HEALTHY");
    assert_eq!(report.components.len(), 4);
    assert_eq!(report.components[0].layer, StackLayer::TanStackStart);
    assert_eq!(report.components[1].layer, StackLayer::RustCore);
    assert_eq!(report.components[2].layer, StackLayer::AxumApi);
    assert_eq!(report.components[3].layer, StackLayer::NativeMobile);
}
