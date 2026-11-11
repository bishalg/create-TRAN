//! A JSON value against a declared shape, as strictly as the server must answer (REQ-CON-006):
//! every violation, each naming its dotted field path (`user.role`, `components[1].name`).

use serde_json::{Map, Value};

use super::{Contract, Operation, Presence, Shape, Type};

/// How a violation at the top of a body names its place.
const ROOT: &str = "(root)";

/// Every way `value` departs from `shape`: an undeclared field, a missing required field, a wrong
/// JSON type, an integer that is not whole or is out of bounds, a string of another format, an
/// empty string declared non-empty, another constant, a value outside an enum. Empty: it conforms.
pub fn validate(shape: &Shape, value: &Value) -> Vec<String> {
    let mut out = Vec::new();
    object(shape, value, "", &mut out);
    out
}

/// An answer of `operation` against the declaration: a declared success against its body (or no
/// body when it declares none), a declared failure against the envelope; any other status is a
/// violation itself.
pub fn validate_answer(
    contract: &Contract,
    operation: &Operation,
    status: u16,
    body: &Value,
) -> Vec<String> {
    if let Some(success) = operation.successes.iter().find(|s| s.status == status) {
        return match success.body {
            Some(shape) => validate(shape, body),
            None if body.is_null() => Vec::new(),
            None => vec![format!("{ROOT}: expected no body, got {}", kind(body))],
        };
    }
    if operation.failures.iter().any(|f| f.status == status) {
        return validate_failure(contract, body);
    }
    vec![format!(
        "status {status} is not declared for {}",
        operation.key()
    )]
}

/// A failure body against the error envelope, for an answer no operation declares (an unknown
/// route or method).
pub fn validate_failure(contract: &Contract, body: &Value) -> Vec<String> {
    validate(contract.envelope, body)
}

/// `parent.name`, or `name` at the top.
fn join(parent: &str, name: &str) -> String {
    match parent {
        "" => name.to_string(),
        _ => format!("{parent}.{name}"),
    }
}

/// The place a violation names: the path, or [`ROOT`] at the top.
fn place(path: &str) -> &str {
    match path {
        "" => ROOT,
        _ => path,
    }
}

/// The JSON type of `value`, as the manifests spell it.
fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn object(shape: &Shape, value: &Value, path: &str, out: &mut Vec<String>) {
    let Value::Object(map) = value else {
        out.push(wrong_type(path, "object", value));
        return;
    };
    fields(shape, map, path, out);
}

fn fields(shape: &Shape, map: &Map<String, Value>, path: &str, out: &mut Vec<String>) {
    for name in map.keys().filter(|name| shape.field(name).is_none()) {
        out.push(format!("{}: undeclared field", join(path, name)));
    }
    for field in shape.fields {
        let at = join(path, field.name);
        match (map.get(field.name), field.presence) {
            (None, Presence::Optional) | (Some(Value::Null), Presence::Nullable) => {}
            (None, _) => out.push(format!("{at}: missing required field")),
            (Some(value), _) => typed(&field.ty, value, &at, out),
        }
    }
}

fn wrong_type(path: &str, expected: &str, value: &Value) -> String {
    format!("{}: expected {expected}, got {}", place(path), kind(value))
}

fn typed(ty: &Type, value: &Value, path: &str, out: &mut Vec<String>) {
    match (ty, value) {
        (Type::Bool, Value::Bool(_))
        | (Type::Number, Value::Number(_))
        | (Type::Scalar, Value::Bool(_) | Value::Number(_) | Value::String(_)) => {}
        (Type::Integer { min, max }, Value::Number(number)) => {
            let whole = number
                .as_i64()
                .map(i128::from)
                .or_else(|| number.as_u64().map(i128::from));
            let Some(n) = whole else {
                out.push(format!("{path}: {number} is not a whole number"));
                return;
            };
            if let Some(min) = min.filter(|min| n < i128::from(*min)) {
                out.push(format!("{path}: {n} is below the minimum {min}"));
            }
            if let Some(max) = max.filter(|max| n > i128::from(*max)) {
                out.push(format!("{path}: {n} is above the maximum {max}"));
            }
        }
        (Type::String { non_empty, format }, Value::String(text)) => {
            if *non_empty && text.is_empty() {
                out.push(format!("{path}: empty string"));
            }
            if let Some(format) = format.filter(|format| !format.matches(text)) {
                out.push(format!("{path}: not a {}", format.as_str()));
            }
        }
        (Type::Constant(literal), value) => {
            if literal.value() != *value {
                out.push(format!("{path}: expected the constant {}", literal.value()));
            }
        }
        (Type::Closed(values), Value::String(text)) => {
            if !values.contains(&text.as_str()) {
                out.push(format!(
                    "{path}: {text:?} is not one of {}",
                    values.join(", ")
                ));
            }
        }
        (Type::Wire(wire), Value::String(text)) => {
            if !wire.values.contains(&text.as_str()) {
                out.push(format!(
                    "{path}: {text:?} is not a value of the wire enum {}",
                    wire.name
                ));
            }
        }
        (Type::Object(shape), value) => object(shape, value, path, out),
        (Type::Array(item), Value::Array(items)) => {
            for (index, value) in items.iter().enumerate() {
                typed(item, value, &format!("{path}[{index}]"), out);
            }
        }
        (Type::Map(item), Value::Object(entries)) => {
            for (key, value) in entries {
                typed(item, value, &join(path, key), out);
            }
        }
        (ty, value) => out.push(wrong_type(path, ty.json_type(), value)),
    }
}
