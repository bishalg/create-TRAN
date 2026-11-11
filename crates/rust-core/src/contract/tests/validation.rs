//! The server-side validator: one test per violation kind, each naming its dotted path, and what
//! conforms (REQ-CON-006).

use super::*;

fn token() -> Value {
    json!({
        "access_token": "a",
        "token_type": "Bearer",
        "expires_in": 900,
        "refresh_token": "r",
        "user": { "user_id": "voter-001", "role": "citizen_voter" }
    })
}

fn health() -> Value {
    json!({
        "report_id": "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c",
        "timestamp": "2026-01-15T12:00:00Z",
        "overall_status": "HEALTHY",
        "components": [
            { "layer": "rustcore", "name": "rust-core", "version": "0.1.0", "healthy": true, "uptime_seconds": 1 },
            { "layer": "axumapi", "name": "axum-api", "version": "0.1.0", "healthy": true, "uptime_seconds": 1 }
        ]
    })
}

fn none() -> Vec<String> {
    Vec::new()
}

// Verifies: REQ-CON-006
#[test]
fn a_conforming_value_has_no_violation() {
    assert_eq!(validate(&SESSION_TOKEN, &token()), none());
    assert_eq!(validate(&HEALTH_REPORT, &health()), none());
    let mut cookie = token();
    cookie.as_object_mut().unwrap().remove("refresh_token");
    assert_eq!(
        validate(&SESSION_TOKEN, &cookie),
        none(),
        "optional, absent"
    );
    let config = json!({
        "config_version": 3,
        "flags": { "a": true, "b": 7, "c": "x", "d": 1.5 },
        "client": { "minimum_version": null, "recommended_version": "1.1.0" }
    });
    assert_eq!(
        validate(&REMOTE_CONFIG, &config),
        none(),
        "nullable null, scalars"
    );
    let request = json!({ "age": 0, "birthdate": "2000-02-29" });
    assert_eq!(validate(&ELIGIBILITY_REQUEST, &request), none());
}

// Verifies: REQ-CON-006
#[test]
fn an_undeclared_field_is_a_violation() {
    let mut value = token();
    value["user"]["nickname"] = json!("x");
    value["extra"] = json!(1);
    assert_eq!(
        validate(&SESSION_TOKEN, &value),
        ["extra: undeclared field", "user.nickname: undeclared field"]
    );
}

// Verifies: REQ-CON-006
#[test]
fn a_missing_required_field_is_a_violation() {
    let mut value = token();
    value["user"].as_object_mut().unwrap().remove("role");
    assert_eq!(
        validate(&SESSION_TOKEN, &value),
        ["user.role: missing required field"]
    );
    let absent = json!({ "client": { "minimum_version": null }, "config_version": 1, "flags": {} });
    assert_eq!(
        validate(&REMOTE_CONFIG, &absent),
        ["client.recommended_version: missing required field"],
        "a nullable field is always present"
    );
}

// Verifies: REQ-CON-006
#[test]
fn a_wrong_json_type_is_a_violation() {
    let mut value = token();
    value["user"] = json!("voter");
    value["access_token"] = json!(null);
    value["refresh_token"] = json!(null);
    assert_eq!(
        validate(&SESSION_TOKEN, &value),
        [
            "access_token: expected string, got null",
            "refresh_token: expected string, got null",
            "user: expected object, got string",
        ]
    );
    assert_eq!(
        validate(&SESSION_TOKEN, &json!([1])),
        ["(root): expected object, got array"]
    );
    let mut value = health();
    value["components"] = json!({});
    assert_eq!(
        validate(&HEALTH_REPORT, &value),
        ["components: expected array, got object"]
    );
    let config = json!({ "config_version": "1", "flags": [], "client": { "minimum_version": 1, "recommended_version": null } });
    assert_eq!(
        validate(&REMOTE_CONFIG, &config),
        [
            "config_version: expected number, got string",
            "flags: expected object, got array",
            "client.minimum_version: expected string, got number",
        ]
    );
    let flags = json!({ "config_version": 1, "flags": { "a": null, "b": [] }, "client": { "minimum_version": null, "recommended_version": null } });
    assert_eq!(
        validate(&REMOTE_CONFIG, &flags),
        [
            "flags.a: expected scalar, got null",
            "flags.b: expected scalar, got array"
        ]
    );
    let bool_and_number = shape(
        "Mixed",
        vec![
            field("b", Type::Bool, Presence::Required),
            field("n", Type::Number, Presence::Required),
        ],
    );
    assert_eq!(
        validate(bool_and_number, &json!({ "b": true, "n": 0.5 })),
        none()
    );
    assert_eq!(
        validate(bool_and_number, &json!({ "b": 1, "n": "0.5" })),
        [
            "b: expected boolean, got number",
            "n: expected number, got string"
        ]
    );
    assert_eq!(
        validate(bool_and_number, &json!({ "b": true, "n": false })),
        ["n: expected number, got boolean"]
    );
}

// Verifies: REQ-CON-006
#[test]
fn an_integer_must_be_whole_and_within_its_bounds() {
    let at = |value: Value| validate(&ELIGIBILITY_REQUEST, &json!({ "age": value }));
    assert_eq!(at(json!(20.5)), ["age: 20.5 is not a whole number"]);
    assert_eq!(at(json!(-1)), ["age: -1 is below the minimum 0"]);
    assert_eq!(
        at(json!(MAX_AGE + 1)),
        [format!(
            "age: {} is above the maximum {MAX_AGE}",
            MAX_AGE + 1
        )]
    );
    assert_eq!(at(json!(MAX_AGE)), none());
    let huge = json!({ "config_version": u64::MAX, "flags": {}, "client": { "minimum_version": null, "recommended_version": null } });
    assert_eq!(
        validate(&REMOTE_CONFIG, &huge),
        none(),
        "beyond i64, unbounded above"
    );
}

// Verifies: REQ-CON-006
#[test]
fn a_string_must_be_of_its_declared_format() {
    let mut value = health();
    value["report_id"] = json!("2f1c7a5e8b0d4c3e9f6a1d2e3f4a5b6c");
    value["timestamp"] = json!("2026-01-15 12:00");
    assert_eq!(
        validate(&HEALTH_REPORT, &value),
        ["report_id: not a uuid", "timestamp: not a date-time"]
    );
    value["report_id"] = json!("2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5bZZ");
    value["timestamp"] = json!("2026-01-15T12:00:00+05:45");
    assert_eq!(validate(&HEALTH_REPORT, &value), ["report_id: not a uuid"]);
    let at = |birthdate: &str| {
        validate(
            &ELIGIBILITY_REQUEST,
            &json!({ "age": 1, "birthdate": birthdate }),
        )
    };
    assert_eq!(at("2000-1-01"), ["birthdate: not a date"]);
    assert_eq!(at("2001-02-29"), ["birthdate: not a date"]);
}

// Verifies: REQ-CON-006
#[test]
fn an_empty_string_declared_non_empty_is_a_violation() {
    let mut value = token();
    value["access_token"] = json!("");
    assert_eq!(
        validate(&SESSION_TOKEN, &value),
        ["access_token: empty string"]
    );
    assert_eq!(
        validate(&REFRESH_REQUEST, &json!({ "refresh_token": "" })),
        none(),
        "a plain string may be empty"
    );
    assert_eq!(
        validate(&ELIGIBILITY_REQUEST, &json!({ "age": 1, "birthdate": "" })),
        ["birthdate: empty string", "birthdate: not a date"]
    );
}

// Verifies: REQ-CON-006
#[test]
fn a_constant_of_another_value_is_a_violation() {
    let mut value = token();
    value["token_type"] = json!("bearer");
    assert_eq!(
        validate(&SESSION_TOKEN, &value),
        ["token_type: expected the constant \"Bearer\""]
    );
    let envelope = json!({ "success": true, "error": "e", "code": "c", "retryable": false, "request_id": "r" });
    assert_eq!(
        validate(&ERROR_ENVELOPE, &envelope),
        ["success: expected the constant false"]
    );
}

// Verifies: REQ-CON-006
#[test]
fn an_enum_value_outside_its_declaration_is_a_violation() {
    let mut value = token();
    value["user"]["role"] = json!("root");
    assert_eq!(
        validate(&SESSION_TOKEN, &value),
        ["user.role: \"root\" is not a value of the wire enum user_role"]
    );
    assert_eq!(
        validate(
            &SIGN_IN_REQUEST,
            &json!({ "role": "root", "transport": "body" })
        ),
        ["role: \"root\" is not one of citizen_voter, election_auditor"]
    );
}

// Verifies: REQ-CON-006
#[test]
fn an_array_item_is_named_by_its_index() {
    let mut value = health();
    value["components"][1]["name"] = json!(7);
    value["components"][1]["uptime_seconds"] = json!(-3);
    assert_eq!(
        validate(&HEALTH_REPORT, &value),
        [
            "components[1].name: expected string, got number",
            "components[1].uptime_seconds: -3 is below the minimum 0",
        ]
    );
}

// Verifies: REQ-CON-006
#[test]
fn an_answer_is_checked_against_its_declared_status() {
    let sign_in = operation(&V1, "POST", "/api/v1/auth/session").unwrap();
    assert_eq!(validate_answer(&V1, sign_in, 201, &token()), none());
    assert_eq!(
        validate_answer(&V1, sign_in, 201, &json!({}))[0],
        "access_token: missing required field"
    );
    let envelope = json!({ "success": false, "error": "e", "code": "request.malformed", "retryable": false, "request_id": "r" });
    assert_eq!(validate_answer(&V1, sign_in, 400, &envelope), none());
    assert_eq!(
        validate_answer(&V1, sign_in, 400, &token())[0],
        "access_token: undeclared field"
    );
    assert_eq!(
        validate_answer(&V1, sign_in, 200, &token()),
        ["status 200 is not declared for POST /api/v1/auth/session"]
    );
    assert_eq!(
        validate_answer(&V1, sign_in, 401, &envelope),
        ["status 401 is not declared for POST /api/v1/auth/session"]
    );
    let config = operation(&V1, "GET", "/api/v1/config").unwrap();
    assert_eq!(validate_answer(&V1, config, 304, &Value::Null), none());
    assert_eq!(
        validate_answer(&V1, config, 304, &json!({})),
        ["(root): expected no body, got object"]
    );
    assert_eq!(validate_failure(&V1, &envelope), none());
    assert_eq!(
        validate_failure(&V1, &Value::Null),
        ["(root): expected object, got null"]
    );
}
