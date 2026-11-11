//! API version 1 (spec 034): every route of `apps/api/src/routes/table.rs` plus `GET /api/health`,
//! in route-table order. Changing a route: edit it here, `pnpm tokens:sync`, then
//! `pnpm contract:snapshots`, and read both diffs (ADR-0053).

mod shapes;

pub use shapes::*;

use super::{Auth, Body, Contract, Failure, Header, Method, Operation, Param, Success, Type};
use crate::compat::{API_BASE_PATH, CLIENT_HEADER, HEALTH_PATH};
use crate::flags::BUCKET_HEADER;

// ---------------------------------------------------------------------------------------------
// Headers, parameters and failures
// ---------------------------------------------------------------------------------------------

const CLIENT: Header = Header {
    name: CLIENT_HEADER,
    required: false,
    doc: "`<platform>/<version>` (`ios/1.4.0`); a client below its minimum is answered `426`.",
};

const DEBUG_COUNTRY: Header = Header {
    name: "X-Debug-Country",
    required: false,
    doc: "Chooses the country; honoured only in development and test.",
};

const REFRESH_COOKIE: Header = Header {
    name: "Cookie",
    required: false,
    doc: "`tran_refresh=<token>` on the cookie transport; the browser sends it itself.",
};

const BUCKET: Header = Header {
    name: BUCKET_HEADER,
    required: false,
    doc: "The device's rollout bucket, `0`-`99`; without it, only full rollouts apply.",
};

const IF_NONE_MATCH: Header = Header {
    name: "If-None-Match",
    required: false,
    doc: "The last answer's `ETag`; an unchanged config is answered `304`.",
};

const INSTALLATION_ID: Param = Param {
    name: "installation_id",
    ty: UUID,
    doc: "The random UUID the app created on first launch.",
};

const MALFORMED: Failure = Failure {
    status: 400,
    doc: "The request is malformed or breaks a rule.",
};
const UNAUTHENTICATED: Failure = Failure {
    status: 401,
    doc: "The session is missing, expired or revoked.",
};
const FOREIGN_ORIGIN: Failure = Failure {
    status: 403,
    doc: "A browser on a foreign origin.",
};
const NOT_FOUND: Failure = Failure {
    status: 404,
    doc: "Not found.",
};
const TOO_LARGE: Failure = Failure {
    status: 413,
    doc: "The body is larger than the server accepts.",
};
const MEDIA_TYPE: Failure = Failure {
    status: 415,
    doc: "The body is not `application/json`.",
};
const UPGRADE: Failure = Failure {
    status: 426,
    doc: "The app is below its platform's minimum version.",
};
const RATE_LIMITED: Failure = Failure {
    status: 429,
    doc: "Too many requests; `Retry-After` says when to try again.",
};
const INTERNAL: Failure = Failure {
    status: 500,
    doc: "An unexpected failure.",
};
const UNAVAILABLE: Failure = Failure {
    status: 503,
    doc: "Overloaded, past the deadline, shutting down, or a store is unavailable.",
};

/// `200` with `$body`.
macro_rules! ok {
    ($body:expr) => {
        Success {
            status: 200,
            body: Some($body),
            doc: "OK.",
        }
    };
}

const NO_CONTENT: Success = Success {
    status: 204,
    body: None,
    doc: "Done; no body.",
};

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------

/// API version 1.
pub static V1: Contract = Contract {
    version: 1,
    envelope: &ERROR_ENVELOPE,
    shapes: &[
        &ERROR_ENVELOPE,
        &HEALTH_COMPONENT,
        &HEALTH_REPORT,
        &STACK_LAYERS,
        &STACK_INFO,
        &COUNTRY,
        &COUNTRIES,
        &ELIGIBILITY_REQUEST,
        &ELIGIBILITY_RESPONSE,
        &SIGN_IN_REQUEST,
        &SESSION_USER,
        &SESSION_TOKEN,
        &REFRESH_REQUEST,
        &DEVICE_REGISTRATION,
        &CLIENT_THRESHOLDS,
        &REMOTE_CONFIG,
    ],
    operations: &[
        Operation {
            id: "getHealth",
            method: Method::Get,
            base: HEALTH_PATH,
            path: "",
            doc: "The process and its components; unversioned, for infrastructure.",
            params: &[],
            auth: Auth::None,
            headers: &[],
            request: None,
            successes: &[ok!(&HEALTH_REPORT)],
            failures: &[INTERNAL, UNAVAILABLE],
        },
        Operation {
            id: "getInfo",
            method: Method::Get,
            base: API_BASE_PATH,
            path: "/tran/info",
            doc: "What the stack is and which version answers.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT],
            request: None,
            successes: &[ok!(&STACK_INFO)],
            failures: &[UPGRADE, RATE_LIMITED, INTERNAL, UNAVAILABLE],
        },
        Operation {
            id: "listCountries",
            method: Method::Get,
            base: API_BASE_PATH,
            path: "/vote/countries",
            doc: "Every supported country and its minimum voting age.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT],
            request: None,
            successes: &[ok!(&COUNTRIES)],
            failures: &[UPGRADE, RATE_LIMITED, INTERNAL, UNAVAILABLE],
        },
        Operation {
            id: "getCountry",
            method: Method::Get,
            base: API_BASE_PATH,
            path: "/vote/countries/{code}",
            doc: "One supported country.",
            params: &[Param {
                name: "code",
                ty: Type::TEXT,
                doc: "ISO 3166-1 alpha-2, either case; another shape is `400`, an unsupported country `404`.",
            }],
            auth: Auth::None,
            headers: &[CLIENT],
            request: None,
            successes: &[ok!(&COUNTRY)],
            failures: &[
                MALFORMED,
                NOT_FOUND,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "checkVoteEligibility",
            method: Method::Post,
            base: API_BASE_PATH,
            path: "/vote/eligibility",
            doc: "Whether an age can vote in the caller's country.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT, DEBUG_COUNTRY],
            request: Some(Body {
                shape: &ELIGIBILITY_REQUEST,
                required: true,
            }),
            successes: &[ok!(&ELIGIBILITY_RESPONSE)],
            failures: &[
                MALFORMED,
                TOO_LARGE,
                MEDIA_TYPE,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "signIn",
            method: Method::Post,
            base: API_BASE_PATH,
            path: "/auth/session",
            doc: "Sign in as a role; the first token pair.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT],
            request: Some(Body {
                shape: &SIGN_IN_REQUEST,
                required: true,
            }),
            successes: &[Success {
                status: 201,
                body: Some(&SESSION_TOKEN),
                doc: "Signed in.",
            }],
            failures: &[
                MALFORMED,
                FOREIGN_ORIGIN,
                TOO_LARGE,
                MEDIA_TYPE,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "whoAmI",
            method: Method::Get,
            base: API_BASE_PATH,
            path: "/auth/session",
            doc: "Who the access token belongs to.",
            params: &[],
            auth: Auth::Bearer,
            headers: &[CLIENT],
            request: None,
            successes: &[ok!(&SESSION_USER)],
            failures: &[
                UNAUTHENTICATED,
                FOREIGN_ORIGIN,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "refresh",
            method: Method::Post,
            base: API_BASE_PATH,
            path: "/auth/refresh",
            doc: "Spend the refresh token for a new pair; a replay ends the session.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT, REFRESH_COOKIE],
            request: Some(Body {
                shape: &REFRESH_REQUEST,
                required: false,
            }),
            successes: &[ok!(&SESSION_TOKEN)],
            failures: &[
                UNAUTHENTICATED,
                FOREIGN_ORIGIN,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "signOut",
            method: Method::Post,
            base: API_BASE_PATH,
            path: "/auth/sign-out",
            doc: "Revoke the session; `204` whatever was sent.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT, REFRESH_COOKIE],
            request: Some(Body {
                shape: &REFRESH_REQUEST,
                required: false,
            }),
            successes: &[NO_CONTENT],
            failures: &[
                FOREIGN_ORIGIN,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "deleteAccount",
            method: Method::Delete,
            base: API_BASE_PATH,
            path: "/account",
            doc: "Erase the caller's account and every session of it.",
            params: &[],
            auth: Auth::Bearer,
            headers: &[CLIENT],
            request: None,
            successes: &[NO_CONTENT],
            failures: &[
                UNAUTHENTICATED,
                FOREIGN_ORIGIN,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "registerDevice",
            method: Method::Put,
            base: API_BASE_PATH,
            path: "/devices/{installation_id}",
            doc: "Create or replace this installation's push registration; idempotent.",
            params: &[INSTALLATION_ID],
            auth: Auth::Bearer,
            headers: &[CLIENT],
            request: Some(Body {
                shape: &DEVICE_REGISTRATION,
                required: true,
            }),
            successes: &[NO_CONTENT],
            failures: &[
                MALFORMED,
                UNAUTHENTICATED,
                FOREIGN_ORIGIN,
                TOO_LARGE,
                MEDIA_TYPE,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "unregisterDevice",
            method: Method::Delete,
            base: API_BASE_PATH,
            path: "/devices/{installation_id}",
            doc: "Remove this installation's registration if it is the caller's; `204` either way.",
            params: &[INSTALLATION_ID],
            auth: Auth::Bearer,
            headers: &[CLIENT],
            request: None,
            successes: &[NO_CONTENT],
            failures: &[
                MALFORMED,
                UNAUTHENTICATED,
                FOREIGN_ORIGIN,
                UPGRADE,
                RATE_LIMITED,
                INTERNAL,
                UNAVAILABLE,
            ],
        },
        Operation {
            id: "getConfig",
            method: Method::Get,
            base: API_BASE_PATH,
            path: "/config",
            doc: "Remote configuration for the caller; never answered `426`, so an old app still learns it must update.",
            params: &[],
            auth: Auth::None,
            headers: &[CLIENT, BUCKET, IF_NONE_MATCH],
            request: None,
            successes: &[
                ok!(&REMOTE_CONFIG),
                Success {
                    status: 304,
                    body: None,
                    doc: "Unchanged since the `ETag` sent.",
                },
            ],
            failures: &[RATE_LIMITED, INTERNAL, UNAVAILABLE],
        },
    ],
};
