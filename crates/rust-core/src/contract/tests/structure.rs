//! One broken mini-declaration per structural rule, each rejected (REQ-CON-002).

use super::*;

const PAYLOAD: Shape = Shape {
    name: "Payload",
    doc: "",
    fields: &[Field {
        name: "n",
        ty: Type::Integer {
            min: Some(0),
            max: Some(0),
        },
        presence: Presence::Required,
        doc: "",
    }],
    closed: false,
};

const OK: Success = Success {
    status: 200,
    body: Some(&PAYLOAD),
    doc: "",
};

/// `GET /api/v1/items/{id}`, well formed: its `{id}` declared, a `200` with a listed shape.
fn op() -> Operation {
    Operation {
        id: "getItem",
        method: Method::Get,
        base: API_BASE_PATH,
        path: "/items/{id}",
        doc: "",
        params: &[Param {
            name: "id",
            ty: Type::TEXT,
            doc: "",
        }],
        auth: Auth::Bearer,
        headers: &[],
        request: None,
        successes: &[OK],
        failures: &[Failure {
            status: 404,
            doc: "",
        }],
    }
}

fn mini(shapes: Vec<&'static Shape>, operations: Vec<Operation>) -> Contract {
    let mut all: Vec<&'static Shape> = vec![leak(*V1.envelope), leak(PAYLOAD)];
    all.extend(shapes);
    Contract {
        version: 1,
        envelope: all[0],
        shapes: leak_slice(all),
        operations: leak_slice(operations),
    }
}

/// The faults of a mini-declaration with `operations` and the extra `shapes`.
fn faults(shapes: Vec<&'static Shape>, operations: Vec<Operation>) -> Vec<String> {
    check(&mini(shapes, operations))
}

/// An operation whose request body is `ty` in a field `x` of a listed shape `Body`.
fn requesting(ty: Type) -> (Vec<&'static Shape>, Operation) {
    let body = shape("Body", vec![field("x", ty, Presence::Required)]);
    let op = Operation {
        request: Some(Body {
            shape: body,
            required: true,
        }),
        ..op()
    };
    (vec![body], op)
}

/// An operation whose `200` is `ty` in a field `x` of a listed shape `Answer`.
fn answering(ty: Type) -> (Vec<&'static Shape>, Operation) {
    let answer = shape("Answer", vec![field("x", ty, Presence::Required)]);
    let op = Operation {
        successes: leak_slice(vec![Success {
            status: 200,
            body: Some(answer),
            doc: "",
        }]),
        ..op()
    };
    (vec![answer], op)
}

#[test]
fn a_mini_declaration_with_every_feature_is_well_formed() {
    let (mut shapes, request) = requesting(Type::Closed(&["a"]));
    let (more, answer) = answering(Type::Array(leak(Type::Wire(USER_ROLE))));
    shapes.extend(more);
    let answer = Operation {
        id: "listItems",
        method: Method::Post,
        path: "/items",
        params: &[],
        ..answer
    };
    assert_eq!(faults(shapes, vec![request, answer]), Vec::<String>::new());
}

// Verifies: REQ-CON-002
#[test]
fn two_shapes_may_not_share_a_name() {
    let twin = shape("Payload", vec![]);
    assert_eq!(
        faults(vec![twin], vec![op()]),
        ["shape Payload is declared twice"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn a_shape_in_use_must_be_listed() {
    let unlisted = shape("Unlisted", vec![]);
    let op = Operation {
        request: Some(Body {
            shape: unlisted,
            required: false,
        }),
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![op]),
        ["GET /api/v1/items/{id} request: the shape Unlisted is not listed in the contract"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn two_operations_may_not_share_a_method_and_path_or_an_id() {
    assert_eq!(
        faults(
            vec![],
            vec![
                op(),
                Operation {
                    id: "other",
                    ..op()
                }
            ]
        ),
        ["GET /api/v1/items/{id} is declared twice"]
    );
    let elsewhere = Operation {
        path: "/things/{id}",
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![op(), elsewhere]),
        ["GET /api/v1/things/{id}: the id getItem is already used"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn path_parameters_and_the_template_must_agree() {
    let undeclared = Operation {
        path: "/items/{id}/{part}/{broken",
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![undeclared]),
        ["GET /api/v1/items/{id}/{part}/{broken: the path parameter part is not declared"]
    );
    let stray = Operation {
        path: "/items",
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![stray]),
        ["GET /api/v1/items: the parameter id is not in the template"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn a_closed_enum_may_not_appear_in_a_response() {
    let (shapes, op) = answering(Type::Array(leak(Type::Closed(&["a"]))));
    assert_eq!(
        faults(shapes, vec![op]),
        ["GET /api/v1/items/{id} 200 Answer.x[]: a closed enum in a response"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn a_wire_enum_may_not_appear_in_a_request() {
    let (shapes, in_body) = requesting(Type::Map(leak(Type::Wire(USER_ROLE))));
    assert_eq!(
        faults(shapes, vec![in_body]),
        ["GET /api/v1/items/{id} request Body.x[]: the wire enum user_role in a request"]
    );
    let in_path = Operation {
        params: &[Param {
            name: "id",
            ty: Type::Wire(COUNTRY_SOURCE),
            doc: "",
        }],
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![in_path]),
        ["GET /api/v1/items/{id} {id}: the wire enum country_source in a request"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn a_wire_enum_must_be_one_of_wire_enums() {
    let inner = shape(
        "Inner",
        vec![field("y", Type::Wire(STRAY), Presence::Optional)],
    );
    let (mut shapes, op) = answering(Type::Object(inner));
    shapes.push(inner);
    assert_eq!(
        faults(shapes, vec![op]),
        ["GET /api/v1/items/{id} 200 Answer.x Inner.y: the wire enum stray is not one of WIRE_ENUMS"]
    );
}

// Verifies: REQ-CON-002
#[test]
fn an_operation_needs_a_2xx_and_statuses_of_their_kind() {
    let none = Operation {
        successes: &[Success {
            status: 304,
            body: None,
            doc: "",
        }],
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![none]),
        ["GET /api/v1/items/{id}: no 2xx response is declared"]
    );
    let misplaced = Operation {
        successes: &[
            OK,
            Success {
                status: 404,
                body: None,
                doc: "",
            },
        ],
        failures: &[Failure {
            status: 302,
            doc: "",
        }],
        ..op()
    };
    assert_eq!(
        faults(vec![], vec![misplaced]),
        [
            "GET /api/v1/items/{id}: the success 404 is not a 2xx or 3xx status",
            "GET /api/v1/items/{id}: the failure 302 is not a 4xx or 5xx status",
        ]
    );
}

// Verifies: REQ-CON-002
#[test]
fn an_integer_minimum_may_not_be_above_its_maximum() {
    let inverted = Type::Integer {
        min: Some(2),
        max: Some(1),
    };
    let (shapes, op) = requesting(inverted);
    assert_eq!(
        faults(shapes, vec![op]),
        ["GET /api/v1/items/{id} request Body.x: the minimum 2 is above the maximum 1"]
    );
    for open in [
        Type::Integer {
            min: Some(2),
            max: None,
        },
        Type::Integer {
            min: None,
            max: Some(1),
        },
    ] {
        let (shapes, op) = requesting(open);
        assert_eq!(faults(shapes, vec![op]), Vec::<String>::new());
    }
}
