//! Whether a declaration is well formed (REQ-CON-002), before anything renders or enforces it.

use super::{Contract, Operation, Shape, Type};
use crate::compat::WIRE_ENUMS;

/// Which way a type travels: a closed enum belongs to requests, a wire enum to responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Request,
    Response,
}

/// Every structural fault of `contract`; empty when it is well formed:
///
/// - two shapes share a name, or a shape in use is not listed in [`Contract::shapes`];
/// - two operations share a method and path, or an id;
/// - a path parameter in a template is undeclared, or a declared one is not in the template;
/// - a closed enum appears in a response, or a wire enum in a request, or a wire enum is not one
///   of [`WIRE_ENUMS`];
/// - an operation declares no `2xx`, a success outside `2xx`–`3xx` or a failure outside
///   `4xx`–`5xx`;
/// - an integer's minimum is above its maximum.
pub fn check(contract: &Contract) -> Vec<String> {
    let mut out = Vec::new();
    for (index, shape) in contract.shapes.iter().enumerate() {
        if contract.shapes[..index]
            .iter()
            .any(|s| s.name == shape.name)
        {
            out.push(format!("shape {} is declared twice", shape.name));
        }
    }
    for (index, op) in contract.operations.iter().enumerate() {
        let key = op.key();
        let earlier = &contract.operations[..index];
        if earlier.iter().any(|o| o.key() == key) {
            out.push(format!("{key} is declared twice"));
        }
        if earlier.iter().any(|o| o.id == op.id) {
            out.push(format!("{key}: the id {} is already used", op.id));
        }
        params(op, &key, &mut out);
        statuses(op, &key, &mut out);
        for param in op.params {
            let at = format!("{key} {{{}}}", param.name);
            typed(contract, &param.ty, Side::Request, &at, &mut out);
        }
        if let Some(body) = op.request {
            let at = format!("{key} request");
            shape(contract, body.shape, Side::Request, &at, &mut out);
        }
        for success in op.successes {
            if let Some(body) = success.body {
                let at = format!("{key} {}", success.status);
                shape(contract, body, Side::Response, &at, &mut out);
            }
        }
    }
    shape(
        contract,
        contract.envelope,
        Side::Response,
        "the envelope",
        &mut out,
    );
    out
}

/// The `{name}` segments of a template and the declared parameters name the same set.
fn params(op: &Operation, key: &str, out: &mut Vec<String>) {
    let named: Vec<&str> = op
        .path
        .split('/')
        .filter_map(|segment| segment.strip_prefix('{')?.strip_suffix('}'))
        .collect();
    for name in &named {
        if !op.params.iter().any(|param| param.name == *name) {
            out.push(format!("{key}: the path parameter {name} is not declared"));
        }
    }
    for param in op.params {
        if !named.contains(&param.name) {
            out.push(format!(
                "{key}: the parameter {} is not in the template",
                param.name
            ));
        }
    }
}

fn statuses(op: &Operation, key: &str, out: &mut Vec<String>) {
    if !op.successes.iter().any(|s| (200..300).contains(&s.status)) {
        out.push(format!("{key}: no 2xx response is declared"));
    }
    for success in op.successes {
        if !(200..400).contains(&success.status) {
            out.push(format!(
                "{key}: the success {} is not a 2xx or 3xx status",
                success.status
            ));
        }
    }
    for failure in op.failures {
        if !(400..600).contains(&failure.status) {
            out.push(format!(
                "{key}: the failure {} is not a 4xx or 5xx status",
                failure.status
            ));
        }
    }
}

fn shape(contract: &Contract, shape: &Shape, side: Side, at: &str, out: &mut Vec<String>) {
    if !contract.shapes.iter().any(|listed| **listed == *shape) {
        out.push(format!(
            "{at}: the shape {} is not listed in the contract",
            shape.name
        ));
    }
    for field in shape.fields {
        let at = format!("{at} {}.{}", shape.name, field.name);
        typed(contract, &field.ty, side, &at, out);
    }
}

fn typed(contract: &Contract, ty: &Type, side: Side, at: &str, out: &mut Vec<String>) {
    match ty {
        Type::Integer {
            min: Some(min),
            max: Some(max),
        } if min > max => out.push(format!(
            "{at}: the minimum {min} is above the maximum {max}"
        )),
        Type::Closed(_) if side == Side::Response => {
            out.push(format!("{at}: a closed enum in a response"));
        }
        Type::Wire(wire) if side == Side::Request => {
            out.push(format!("{at}: the wire enum {} in a request", wire.name));
        }
        Type::Wire(wire) if !WIRE_ENUMS.contains(wire) => {
            out.push(format!(
                "{at}: the wire enum {} is not one of WIRE_ENUMS",
                wire.name
            ));
        }
        Type::Object(inner) => shape(contract, inner, side, at, out),
        Type::Array(item) | Type::Map(item) => {
            typed(contract, item, side, &format!("{at}[]"), out);
        }
        _ => {}
    }
}
