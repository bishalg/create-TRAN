//! The declaration checks itself, renders the committed request list unchanged, and every recorded
//! answer conforms to it (spec 034).
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test code")]

use std::fs;

use serde_json::{json, Value};

use super::*;
use crate::compat::{WireEnum, API_BASE_PATH, COUNTRY_SOURCE, HEALTH_PATH, USER_ROLE, WIRE_ENUMS};
use crate::test_support::workspace_root;
use crate::validation::MAX_AGE;

mod structure;
mod validation;

fn fixture(name: &str) -> String {
    fs::read_to_string(workspace_root().join("fixtures/contract/v1").join(name)).unwrap()
}

fn leak<T>(value: T) -> &'static T {
    Box::leak(Box::new(value))
}

fn leak_slice<T>(values: Vec<T>) -> &'static [T] {
    Box::leak(values.into_boxed_slice())
}

/// A field of `ty`, required unless said otherwise.
fn field(name: &'static str, ty: Type, presence: Presence) -> Field {
    Field {
        name,
        ty,
        presence,
        doc: "",
    }
}

fn shape(name: &'static str, fields: Vec<Field>) -> &'static Shape {
    leak(Shape {
        name,
        doc: "",
        fields: leak_slice(fields),
        closed: false,
    })
}

// Verifies: REQ-CON-002
#[test]
fn v1_is_well_formed() {
    assert_eq!(check(&V1), Vec::<String>::new());
}

// Verifies: REQ-CON-002
#[test]
fn rule_data_comes_from_its_rust_core_constant() {
    let age = Type::Integer {
        min: Some(0),
        max: Some(i64::from(MAX_AGE)),
    };
    let ty = |shape: &Shape, name: &str| shape.field(name).unwrap().ty;
    assert_eq!(ty(&ELIGIBILITY_REQUEST, "age"), age);
    assert_eq!(ty(&ELIGIBILITY_RESPONSE, "age"), age);
    assert_eq!(ty(&COUNTRY, "minimum_age"), age);
    assert_eq!(ty(&SIGN_IN_REQUEST, "role"), Type::Closed(USER_ROLE.values));
    assert_eq!(
        SESSION_USER.field("role").unwrap().ty,
        Type::Wire(USER_ROLE)
    );
    assert_eq!(
        ELIGIBILITY_RESPONSE.field("country_source").unwrap().ty,
        Type::Wire(COUNTRY_SOURCE)
    );
    let health = operation(&V1, "GET", HEALTH_PATH).unwrap();
    assert_eq!(health.base, HEALTH_PATH);
    assert!(V1
        .operations
        .iter()
        .filter(|op| op.id != health.id)
        .all(|op| op.base == API_BASE_PATH));
    assert_eq!(V1.version, 1);
    assert_eq!(V1.envelope.name, "ErrorEnvelope");
}

/// The same list, in the same order, as the route table renders to `routes.json`; the live test
/// in `apps/api` proves it against the router itself (REQ-CON-001).
#[test]
fn v1_declares_the_recorded_routes_in_their_order() {
    let routes: Vec<String> = serde_json::from_str(&fixture("routes.json")).unwrap();
    let keys: Vec<String> = V1.operations.iter().map(Operation::key).collect();
    assert_eq!(keys, routes);
}

/// Rendering the request list from the declaration changes no data and no byte: compared both
/// parsed and as the bytes `contract_test.rs` writes (`to_string_pretty` and a newline).
#[test]
fn the_request_list_renders_the_committed_fixture() {
    let committed = fixture("requests.json");
    let rendered = request_fields(&V1);
    assert_eq!(rendered, serde_json::from_str::<Value>(&committed).unwrap());
    assert_eq!(
        format!("{}\n", serde_json::to_string_pretty(&rendered).unwrap()),
        committed
    );
}

// Verifies: REQ-CON-006
#[test]
fn every_recorded_answer_conforms_to_v1() {
    let answers: Vec<Value> = serde_json::from_str(&fixture("responses.json")).unwrap();
    assert!(!answers.is_empty());
    let mut checked = 0;
    for answer in &answers {
        let case = answer["case"].as_str().unwrap();
        let route = answer["route"].as_str().unwrap();
        let status = u16::try_from(answer["status"].as_u64().unwrap()).unwrap();
        let (method, template) = route.split_once(' ').unwrap();
        let violations = match operation(&V1, method, template) {
            Some(op) => {
                checked += 1;
                validate_answer(&V1, op, status, &answer["body"])
            }
            // An unknown route, version or method: always the envelope.
            None => {
                assert!(status >= 400, "{case}: {route} answered {status}");
                validate_failure(&V1, &answer["body"])
            }
        };
        assert_eq!(violations, Vec::<String>::new(), "{case}: {route} {status}");
    }
    assert!(checked >= V1.operations.len(), "{checked} declared answers");
}

#[test]
fn operations_are_found_by_method_and_template() {
    let op = operation(&V1, "GET", "/api/v1/vote/countries/{code}").unwrap();
    assert_eq!(op.id, "getCountry");
    assert_eq!(op.template(), "/api/v1/vote/countries/{code}");
    assert_eq!(op.key(), "GET /api/v1/vote/countries/{code}");
    assert_eq!(
        operation(&V1, "DELETE", "/api/v1/devices/{installation_id}")
            .unwrap()
            .id,
        "unregisterDevice"
    );
    assert!(operation(&V1, "POST", "/api/v1/vote/countries/{code}").is_none());
    assert!(operation(&V1, "GET", "/api/v1/vote/countries/BR").is_none());
    assert!(operation(&V1, "get", "/api/v1/config").is_none());
}

#[test]
fn fields_are_found_by_dotted_path() {
    let name = |shape: &Shape, path: &str| field_at(shape, path).map(|field| field.name);
    assert_eq!(name(&SESSION_TOKEN, "user.role"), Some("role"));
    assert_eq!(name(&SESSION_TOKEN, "user"), Some("user"));
    assert_eq!(name(&HEALTH_REPORT, "components[].name"), Some("name"));
    assert_eq!(
        name(&HEALTH_REPORT, "components[1].uptime_seconds"),
        Some("uptime_seconds")
    );
    assert_eq!(name(&HEALTH_REPORT, "components[]"), Some("components"));
    assert_eq!(name(&STACK_INFO, "layers.T"), Some("T"));
    assert_eq!(name(&REMOTE_CONFIG, "flags"), Some("flags"));
    assert_eq!(
        field_at(&SESSION_USER, "role").unwrap().ty,
        Type::Wire(USER_ROLE)
    );
    for miss in [
        "",
        "nope",
        "user.nope",
        "user.role.x",
        "access_token.x",
        "components.name",
        "components[x].name",
        "components[1.name",
        "user[].role",
        "nope[].role",
    ] {
        assert_eq!(field_at(&SESSION_TOKEN, miss), None, "{miss}");
        assert_eq!(field_at(&HEALTH_REPORT, miss), None, "{miss}");
    }
    // A map's keys are free, so none of them is a declared field.
    assert_eq!(field_at(&REMOTE_CONFIG, "flags.notify_me"), None);
}

#[test]
fn names_and_json_types_are_the_wire_spellings() {
    let methods = [Method::Get, Method::Post, Method::Put, Method::Delete].map(Method::as_str);
    assert_eq!(methods, ["GET", "POST", "PUT", "DELETE"]);
    let formats = [Format::Uuid, Format::Date, Format::DateTime].map(Format::as_str);
    assert_eq!(formats, ["uuid", "date", "date-time"]);
    assert_eq!(Literal::Bool(false).value(), json!(false));
    assert_eq!(Literal::Str("Bearer").value(), json!("Bearer"));
    let item = leak(Type::Bool);
    let types = [
        (Type::Bool, "boolean"),
        (Type::Constant(Literal::Bool(true)), "boolean"),
        (
            Type::Integer {
                min: None,
                max: None,
            },
            "number",
        ),
        (Type::Number, "number"),
        (Type::STRING, "string"),
        (Type::TEXT, "string"),
        (Type::Constant(Literal::Str("x")), "string"),
        (Type::Closed(&["a"]), "string"),
        (Type::Wire(USER_ROLE), "string"),
        (Type::Object(&COUNTRY), "object"),
        (Type::Map(item), "object"),
        (Type::Array(item), "array"),
        (Type::Scalar, "scalar"),
    ];
    for (ty, json_type) in types {
        assert_eq!(ty.json_type(), json_type, "{ty:?}");
    }
    assert!(WIRE_ENUMS.contains(&USER_ROLE));
}

/// A wire enum `compat.rs` does not list, for the structural tests.
const STRAY: WireEnum = WireEnum {
    name: "stray",
    field: "stray",
    values: &["a"],
    fallback: "a",
};
