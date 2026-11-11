//! The HTTP contract (spec 034, ADR-0053): every operation of the API, its request and its
//! answers, declared once as data. `pnpm tokens:sync` renders it to Zod and OpenAPI; the live
//! contract test holds the real router to it; [`validate`] checks a JSON value against a shape.
//!
//! The vocabulary is deliberately small: see [`Type`] and [`Presence`]. Rule data a field depends
//! on (the age limit, the role values, the wire enums, the base paths) is read from its `rust-core`
//! constant, never repeated (REQ-CON-002).
//!
//! Verifies: REQ-CON-002

mod check;
mod v1;
mod validate;

pub use check::check;
pub use v1::*;
pub use validate::{validate, validate_answer, validate_failure};

use serde_json::{json, Map, Value};

use crate::compat::WireEnum;

/// An HTTP method the API serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Delete,
}

impl Method {
    /// The wire spelling, `GET`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Delete => "DELETE",
        }
    }
}

/// A format a string is held to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// A hyphenated UUID (`2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c`), either case.
    Uuid,
    /// A calendar date, exactly `YYYY-MM-DD` ([`crate::voting::parse_iso_date`]).
    Date,
    /// An RFC 3339 timestamp (`2026-01-15T12:00:00Z`).
    DateTime,
}

impl Format {
    /// The OpenAPI spelling: `uuid`, `date`, `date-time`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uuid => "uuid",
            Self::Date => "date",
            Self::DateTime => "date-time",
        }
    }

    /// Whether `value` is of this format.
    pub fn matches(self, value: &str) -> bool {
        match self {
            Self::Uuid => value.len() == 36 && uuid::Uuid::parse_str(value).is_ok(),
            Self::Date => crate::voting::parse_iso_date(value).is_some(),
            Self::DateTime => chrono::DateTime::parse_from_rfc3339(value).is_ok(),
        }
    }
}

/// The value of a [`Type::Constant`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Literal {
    Bool(bool),
    Str(&'static str),
}

impl Literal {
    /// The literal as JSON.
    pub fn value(self) -> Value {
        match self {
            Self::Bool(value) => json!(value),
            Self::Str(value) => json!(value),
        }
    }
}

/// What a field holds (ADR-0053 decision 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Type {
    Bool,
    /// A whole number, within the bounds when given.
    Integer {
        min: Option<i64>,
        max: Option<i64>,
    },
    /// Any JSON number.
    Number,
    /// A string; `non_empty` refuses `""`; `format` holds it to a [`Format`].
    String {
        non_empty: bool,
        format: Option<Format>,
    },
    /// Exactly this value.
    Constant(Literal),
    /// A request string that takes only these values; never in a response.
    Closed(&'static [&'static str]),
    /// A response string with known values and a fallback (REQ-VER-008), one of
    /// [`crate::compat::WIRE_ENUMS`]; never in a request.
    Wire(WireEnum),
    /// A named shape.
    Object(&'static Shape),
    /// A list of items of one type.
    Array(&'static Type),
    /// An object with free keys and values of one type.
    Map(&'static Type),
    /// `bool | number | string`, for flag values.
    Scalar,
}

impl Type {
    /// A string that may be empty, of no format.
    pub const STRING: Self = Self::String {
        non_empty: false,
        format: None,
    };

    /// A non-empty string of no format.
    pub const TEXT: Self = Self::String {
        non_empty: true,
        format: None,
    };

    /// The JSON type a value of this type has, as the client manifests spell it (`boolean`,
    /// `number`, `string`, `object`, `array`). A [`Type::Scalar`] is `scalar`: any of the first three.
    pub fn json_type(&self) -> &'static str {
        match self {
            Self::Bool | Self::Constant(Literal::Bool(_)) => "boolean",
            Self::Integer { .. } | Self::Number => "number",
            Self::String { .. }
            | Self::Constant(Literal::Str(_))
            | Self::Closed(_)
            | Self::Wire(_) => "string",
            Self::Object(_) | Self::Map(_) => "object",
            Self::Array(_) => "array",
            Self::Scalar => "scalar",
        }
    }
}

/// Whether a field must be there, and whether it may be `null`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    /// Always present, never `null`.
    Required,
    /// May be absent; when present, never `null`.
    Optional,
    /// Always present; may be `null`.
    Nullable,
}

/// One named field of a [`Shape`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Field {
    pub name: &'static str,
    pub ty: Type,
    pub presence: Presence,
    pub doc: &'static str,
}

/// A named JSON object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    /// Unique in a [`Contract`]: the schema's name in every rendering (`SessionUser`).
    pub name: &'static str,
    pub doc: &'static str,
    pub fields: &'static [Field],
    /// Unknown fields are refused (a request the server reads with `deny_unknown_fields`).
    pub closed: bool,
}

impl Shape {
    /// The field named `name`, if declared.
    pub fn field(&self, name: &str) -> Option<&'static Field> {
        self.fields.iter().find(|field| field.name == name)
    }
}

/// How an operation authenticates its caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Auth {
    /// Anyone may call it.
    None,
    /// `Authorization: Bearer <access token>`; without it the answer is `401`.
    Bearer,
}

/// A request header an operation reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub name: &'static str,
    pub required: bool,
    pub doc: &'static str,
}

/// A `{name}` segment of a path template.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Param {
    pub name: &'static str,
    pub ty: Type,
    pub doc: &'static str,
}

/// The JSON body an operation reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Body {
    pub shape: &'static Shape,
    /// `false`: the body may be left out altogether.
    pub required: bool,
}

/// A success (`2xx`, or `3xx` such as `304`) and its body; `None`: no body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Success {
    pub status: u16,
    pub body: Option<&'static Shape>,
    pub doc: &'static str,
}

/// A failure status (`4xx`, `5xx`); its body is always the [`Contract::envelope`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Failure {
    pub status: u16,
    pub doc: &'static str,
}

/// One route: method, path and everything it reads and answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Operation {
    /// Unique in a [`Contract`]: the OpenAPI `operationId` (`signIn`).
    pub id: &'static str,
    pub method: Method,
    /// The base path the route lives under ([`crate::compat::API_BASE_PATH`], or the health
    /// path itself).
    pub base: &'static str,
    /// The rest of the template below [`Operation::base`] (`/vote/countries/{code}`); may be empty.
    pub path: &'static str,
    pub doc: &'static str,
    pub params: &'static [Param],
    pub auth: Auth,
    pub headers: &'static [Header],
    pub request: Option<Body>,
    pub successes: &'static [Success],
    pub failures: &'static [Failure],
}

impl Operation {
    /// The whole path template, `/api/v1/vote/countries/{code}`.
    pub fn template(&self) -> String {
        format!("{}{}", self.base, self.path)
    }

    /// `GET /api/v1/vote/countries/{code}`: how the route table and the fixtures name it.
    pub fn key(&self) -> String {
        format!("{} {}", self.method.as_str(), self.template())
    }
}

/// One version of the API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Contract {
    /// The API version (`1`), never the product version.
    pub version: u32,
    /// Every failure's body (REQ-ERR-002).
    pub envelope: &'static Shape,
    /// Every shape an operation or the envelope uses, each once, in rendering order.
    pub shapes: &'static [&'static Shape],
    pub operations: &'static [Operation],
}

/// The operation of `contract` answering `method` (`GET`) on `template`
/// (`/api/v1/vote/countries/{code}`), if declared.
pub fn operation<'a>(
    contract: &'a Contract,
    method: &str,
    template: &str,
) -> Option<&'a Operation> {
    contract
        .operations
        .iter()
        .find(|op| op.method.as_str() == method && op.template() == template)
}

/// The declared field at a dotted `path` of `shape`: `user.role`, `layers.T`, and through an array
/// with `[]` or an index: `components[].name`, `components[1].name`. `None` when any step is not
/// declared, or steps into something other than an object.
pub fn field_at(shape: &Shape, path: &str) -> Option<&'static Field> {
    let mut found: Option<(&'static Field, &'static Type)> = None;
    for part in path.split('.') {
        let within = match found {
            None => shape,
            Some((_, Type::Object(inner))) => inner,
            Some(_) => return None,
        };
        found = Some(step(within, part)?);
    }
    found.map(|(field, _)| field)
}

/// One step of [`field_at`]: the field `part` names, and the type the next step looks into (an
/// array's item when `part` ends with an index).
fn step(shape: &Shape, part: &str) -> Option<(&'static Field, &'static Type)> {
    match part.split_once('[') {
        Some((name, index)) => {
            let field = shape.field(name)?;
            let digits = index.strip_suffix(']')?;
            let Type::Array(item) = &field.ty else {
                return None;
            };
            digits
                .bytes()
                .all(|b| b.is_ascii_digit())
                .then_some((field, *item))
        }
        None => shape.field(part).map(|field| (field, &field.ty)),
    }
}

/// The request bodies of `contract` in the format of `fixtures/contract/v1/requests.json`: per
/// operation that reads one (`POST /api/v1/auth/session`), each field's JSON type and whether it
/// must be sent.
pub fn request_fields(contract: &Contract) -> Value {
    let mut routes = Map::new();
    for op in contract.operations {
        if let Some(body) = op.request {
            let fields: Map<String, Value> = body
                .shape
                .fields
                .iter()
                .map(|field| {
                    let required = field.presence != Presence::Optional;
                    let spec = json!({ "type": field.ty.json_type(), "required": required });
                    (field.name.to_string(), spec)
                })
                .collect();
            routes.insert(op.key(), Value::Object(fields));
        }
    }
    Value::Object(routes)
}

#[cfg(test)]
mod tests;
