//! The shapes of API version 1: every request and answer body, and the error envelope.

use crate::compat::{COUNTRY_SOURCE, USER_ROLE};
use crate::contract::{Field, Format, Literal, Presence, Shape, Type};
use crate::validation::MAX_AGE;

/// A [`Field`] literal: name, type, presence, doc.
macro_rules! field {
    ($name:literal, $ty:expr, $presence:ident, $doc:literal) => {
        Field {
            name: $name,
            ty: $ty,
            presence: Presence::$presence,
            doc: $doc,
        }
    };
}

pub(super) const UUID: Type = Type::String {
    non_empty: true,
    format: Some(Format::Uuid),
};

const TIMESTAMP: Type = Type::String {
    non_empty: true,
    format: Some(Format::DateTime),
};

/// An age in whole years, bounded by the rules' [`MAX_AGE`].
const AGE: Type = Type::Integer {
    min: Some(0),
    max: Some(MAX_AGE as i64),
};

const COUNT: Type = Type::Integer {
    min: Some(0),
    max: None,
};

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

/// The one failure body (REQ-ERR-002).
pub const ERROR_ENVELOPE: Shape = Shape {
    name: "ErrorEnvelope",
    doc: "Every failure: a developer message, a stable code the client localizes, whether a retry may help, and the request id.",
    fields: &[
        field!("success", Type::Constant(Literal::Bool(false)), Required, "Always false."),
        field!("error", Type::TEXT, Required, "A developer message; clients show the copy for `code`."),
        field!("code", Type::TEXT, Required, "The catalogue code (`validation.age_out_of_range`); an unknown code is classified by its status."),
        field!("retryable", Type::Bool, Required, "Whether the same request may succeed later."),
        field!("request_id", Type::TEXT, Required, "The request's id, also in `X-Request-Id` and the server log."),
    ],
    closed: false,
};

pub const HEALTH_COMPONENT: Shape = Shape {
    name: "HealthComponent",
    doc: "One component the API process observes from inside itself.",
    fields: &[
        field!(
            "layer",
            Type::TEXT,
            Required,
            "The stack layer (`rustcore`, `axumapi`)."
        ),
        field!("name", Type::TEXT, Required, "The component's name."),
        field!("version", Type::TEXT, Required, "The component's version."),
        field!("healthy", Type::Bool, Required, "Whether it is healthy."),
        field!(
            "uptime_seconds",
            COUNT,
            Required,
            "Seconds since the process started."
        ),
    ],
    closed: false,
};

pub const HEALTH_REPORT: Shape = Shape {
    name: "HealthReport",
    doc: "`GET /api/health`: the process and its components.",
    fields: &[
        field!("report_id", UUID, Required, "A fresh id per report."),
        field!(
            "timestamp",
            TIMESTAMP,
            Required,
            "When the report was made."
        ),
        field!(
            "overall_status",
            Type::TEXT,
            Required,
            "`HEALTHY` while every component is."
        ),
        field!(
            "components",
            Type::Array(&Type::Object(&HEALTH_COMPONENT)),
            Required,
            "Every component."
        ),
    ],
    closed: false,
};

pub const STACK_LAYERS: Shape = Shape {
    name: "StackLayers",
    doc: "What each letter of TRAN stands for.",
    fields: &[
        field!("T", Type::TEXT, Required, "The web layer."),
        field!("R", Type::TEXT, Required, "The Rust core."),
        field!("A", Type::TEXT, Required, "The Axum API."),
        field!("N", Type::TEXT, Required, "The native apps."),
    ],
    closed: false,
};

pub const STACK_INFO: Shape = Shape {
    name: "StackInfo",
    doc: "`GET /api/v1/tran/info`: what the stack is and which version answers.",
    fields: &[
        field!("stack", Type::TEXT, Required, "The stack's name."),
        field!(
            "description",
            Type::TEXT,
            Required,
            "One line about the demo."
        ),
        field!("demo", Type::TEXT, Required, "The demo's id."),
        field!(
            "layers",
            Type::Object(&STACK_LAYERS),
            Required,
            "The four layers."
        ),
        field!(
            "version",
            Type::TEXT,
            Required,
            "The API's product version."
        ),
    ],
    closed: false,
};

pub const COUNTRY: Shape = Shape {
    name: "CountryVotingAge",
    doc: "One supported country and its minimum voting age.",
    fields: &[
        field!("country_code", Type::TEXT, Required, "ISO 3166-1 alpha-2."),
        field!(
            "minimum_age",
            AGE,
            Required,
            "The minimum voting age there."
        ),
    ],
    closed: false,
};

pub const COUNTRIES: Shape = Shape {
    name: "Countries",
    doc: "`GET /api/v1/vote/countries`: every supported country, sorted by code.",
    fields: &[field!(
        "countries",
        Type::Array(&Type::Object(&COUNTRY)),
        Required,
        "The countries."
    )],
    closed: false,
};

pub const ELIGIBILITY_REQUEST: Shape = Shape {
    name: "VoteEligibilityRequest",
    doc: "Who asks whether they can vote: an age, or a birth date the server derives it from.",
    fields: &[
        field!(
            "age",
            AGE,
            Required,
            "Whole years; replaced by the age derived from `birthdate` when given."
        ),
        field!(
            "birthdate",
            Type::String {
                non_empty: true,
                format: Some(Format::Date)
            },
            Optional,
            "Exactly `YYYY-MM-DD`, not in the future."
        ),
    ],
    closed: false,
};

pub const ELIGIBILITY_RESPONSE: Shape = Shape {
    name: "VoteEligibilityResponse",
    doc: "The verdict, the rule it applied and how the country was chosen.",
    fields: &[
        field!(
            "eligibility_id",
            UUID,
            Required,
            "A fresh id per evaluation."
        ),
        field!(
            "eligible",
            Type::Bool,
            Required,
            "Whether the age meets the minimum."
        ),
        field!("age", AGE, Required, "The age evaluated."),
        field!(
            "minimum_age",
            AGE,
            Required,
            "The country's minimum voting age."
        ),
        field!(
            "country_code",
            Type::TEXT,
            Required,
            "The country evaluated (ISO 3166-1 alpha-2)."
        ),
        field!(
            "country_source",
            Type::Wire(COUNTRY_SOURCE),
            Required,
            "How the server chose the country."
        ),
        field!(
            "client_ip",
            Type::TEXT,
            Required,
            "The address the country was resolved from."
        ),
        field!(
            "reason",
            Type::TEXT,
            Required,
            "A developer explanation of the verdict."
        ),
        field!(
            "evaluated_at",
            TIMESTAMP,
            Required,
            "When it was evaluated."
        ),
    ],
    closed: false,
};

pub const SIGN_IN_REQUEST: Shape = Shape {
    name: "SignInRequest",
    doc: "The sample's sign-in: choosing a role is the whole login.",
    fields: &[
        field!(
            "role",
            Type::Closed(USER_ROLE.values),
            Required,
            "The role to sign in as."
        ),
        field!(
            "transport",
            Type::Closed(&["cookie", "body"]),
            Required,
            "Where the refresh token travels: an HttpOnly cookie (web) or the body (native)."
        ),
    ],
    closed: false,
};

pub const SESSION_USER: Shape = Shape {
    name: "SessionUser",
    doc: "Who a session belongs to.",
    fields: &[
        field!("user_id", Type::TEXT, Required, "The user's id."),
        field!(
            "role",
            Type::Wire(USER_ROLE),
            Required,
            "The user's role; an unknown one reads as the voter."
        ),
    ],
    closed: false,
};

pub const SESSION_TOKEN: Shape = Shape {
    name: "SessionToken",
    doc: "A new token pair: the answer to a sign-in and a refresh.",
    fields: &[
        field!(
            "access_token",
            Type::TEXT,
            Required,
            "Sent as `Authorization: Bearer <access_token>`."
        ),
        field!(
            "token_type",
            Type::Constant(Literal::Str("Bearer")),
            Required,
            "Always `Bearer`."
        ),
        field!(
            "expires_in",
            Type::Integer {
                min: Some(1),
                max: None
            },
            Required,
            "Seconds the access token lives."
        ),
        field!(
            "refresh_token",
            Type::TEXT,
            Optional,
            "Only on the body transport; the cookie transport sets it as a cookie instead."
        ),
        field!(
            "user",
            Type::Object(&SESSION_USER),
            Required,
            "Who signed in."
        ),
    ],
    closed: false,
};

pub const REFRESH_REQUEST: Shape = Shape {
    name: "RefreshRequest",
    doc: "The refresh token on the body transport; the cookie, when sent, wins.",
    fields: &[field!(
        "refresh_token",
        Type::STRING,
        Optional,
        "The refresh token the body transport was given."
    )],
    closed: false,
};

pub const DEVICE_REGISTRATION: Shape = Shape {
    name: "DeviceRegistration",
    doc: "This installation's push token, bound to the caller and the session.",
    fields: &[
        field!(
            "platform",
            Type::Closed(&["ios", "android"]),
            Required,
            "Whose push service the token is for."
        ),
        field!(
            "push_token",
            Type::TEXT,
            Required,
            "iOS: even-length hex, 64-200 characters; Android: 32-1024 of `[A-Za-z0-9_:-]`."
        ),
        field!(
            "environment",
            Type::Closed(&["sandbox", "production"]),
            Required,
            "The APNs gateway; Android is always `production`."
        ),
        field!(
            "locale",
            Type::TEXT,
            Required,
            "A language tag (`en`, `ne-NP`)."
        ),
        field!(
            "app_version",
            Type::TEXT,
            Required,
            "The app's version (`1.4.0`)."
        ),
        field!(
            "marketing",
            Type::Bool,
            Optional,
            "Whether the person opted in to marketing messages; false when left out."
        ),
    ],
    closed: true,
};

pub const CLIENT_THRESHOLDS: Shape = Shape {
    name: "ClientThresholds",
    doc: "The caller's platform's version thresholds; `null` when none is configured.",
    fields: &[
        field!(
            "minimum_version",
            Type::TEXT,
            Nullable,
            "Below it the API answers `426`."
        ),
        field!(
            "recommended_version",
            Type::TEXT,
            Nullable,
            "Below it the app offers a dismissible update."
        ),
    ],
    closed: false,
};

pub const REMOTE_CONFIG: Shape = Shape {
    name: "RemoteConfig",
    doc: "`GET /api/v1/config`: every declared flag evaluated for the caller, and its thresholds.",
    fields: &[
        field!(
            "config_version",
            COUNT,
            Required,
            "Changes whenever the rules do."
        ),
        field!(
            "flags",
            Type::Map(&Type::Scalar),
            Required,
            "Flag id to value; an unknown flag is ignored."
        ),
        field!(
            "client",
            Type::Object(&CLIENT_THRESHOLDS),
            Required,
            "The caller's thresholds."
        ),
    ],
    closed: false,
};
