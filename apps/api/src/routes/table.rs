//! The product route table (spec 028): every route under [`API_BASE_PATH`], its method and
//! whether it is deprecated. The router is built from it, the access log names a request by its
//! route template, the deprecation layer reads it and the contract snapshots walk it, so a route
//! exists in one place only.

use std::borrow::Cow;

use axum::http::Method;
use axum::routing::{delete, get, post, put, MethodRouter};
use chrono::DateTime;
use rust_core::compat::API_BASE_PATH;
use rust_core::rate::RouteClass;

use super::{account, auth, devices, tran, vote};
use crate::state::AppState;

/// A deprecated route's two dates, in seconds since the Unix epoch (REQ-VER-007). It keeps working
/// until removed; the dates are announced on every answer meanwhile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sunset {
    /// When it was deprecated: `Deprecation: @<seconds>` (RFC 9745).
    pub deprecated_at: i64,
    /// When it may stop answering: `Sunset: <HTTP-date>` (RFC 8594).
    pub sunset_at: i64,
}

impl Sunset {
    /// The `Deprecation` header value: a structured-field date, `@` and the seconds.
    pub fn deprecation_header(&self) -> String {
        format!("@{}", self.deprecated_at)
    }

    /// The `Sunset` header value: an IMF-fixdate (`Sun, 31 Jan 2027 00:00:00 GMT`).
    pub fn sunset_header(&self) -> String {
        DateTime::from_timestamp(self.sunset_at, 0)
            .unwrap_or_default()
            .format("%a, %d %b %Y %H:%M:%S GMT")
            .to_string()
    }
}

/// A route's method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    Get,
    Post,
    Put,
    Delete,
}

impl Verb {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Delete => "DELETE",
        }
    }

    fn matches(self, method: &Method) -> bool {
        method.as_str() == self.as_str()
    }
}

/// One product route.
#[derive(Clone, Copy)]
pub struct Route {
    pub verb: Verb,
    /// The template below [`API_BASE_PATH`] (`/vote/countries/{code}`).
    pub path: &'static str,
    /// Rate limiting class (REQ-RL-001).
    pub class: RouteClass,
    /// `Some` once the route is deprecated; it then needs a sunset date.
    pub deprecated: Option<Sunset>,
    /// The handler, with the verb's method router.
    pub handler: fn() -> MethodRouter<AppState>,
}

impl std::fmt::Debug for Route {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.verb.as_str(), self.template())
    }
}

impl Route {
    pub const fn new(
        verb: Verb,
        path: &'static str,
        class: RouteClass,
        handler: fn() -> MethodRouter<AppState>,
    ) -> Self {
        Self {
            verb,
            path,
            class,
            deprecated: None,
            handler,
        }
    }

    /// The full template, `/api/v1/vote/countries/{code}`.
    pub fn template(&self) -> String {
        format!("{API_BASE_PATH}{}", self.path)
    }

    /// Whether `path` (a request's) fits this route's template, whatever the method.
    pub fn fits(&self, path: &str) -> bool {
        let Some(rest) = path.strip_prefix(API_BASE_PATH) else {
            return false;
        };
        let (mut want, mut got) = (self.path.split('/'), rest.split('/'));
        loop {
            match (want.next(), got.next()) {
                (None, None) => return true,
                (Some(w), Some(g)) if w.starts_with('{') && !g.is_empty() => {}
                (Some(w), Some(g)) if w == g => {}
                _ => return false,
            }
        }
    }
}

/// Every product route, in documentation order. No route is deprecated in the sample; mark one
/// with `deprecated: Some(Sunset { .. })` and the layer announces it (REQ-VER-007).
pub static ROUTES: [Route; 11] = [
    Route::new(Verb::Get, "/tran/info", RouteClass::Read, || {
        get(tran::stack_info_handler)
    }),
    Route::new(Verb::Get, "/vote/countries", RouteClass::Read, || {
        get(vote::list_countries_handler)
    }),
    Route::new(
        Verb::Get,
        "/vote/countries/{code}",
        RouteClass::Read,
        || get(vote::get_country_handler),
    ),
    Route::new(Verb::Post, "/vote/eligibility", RouteClass::Read, || {
        post(vote::eligibility_handler)
    }),
    Route::new(Verb::Post, "/auth/session", RouteClass::Auth, || {
        post(auth::sign_in)
    }),
    Route::new(Verb::Get, "/auth/session", RouteClass::Read, || {
        get(auth::current_session)
    }),
    Route::new(Verb::Post, "/auth/refresh", RouteClass::Auth, || {
        post(auth::refresh)
    }),
    Route::new(Verb::Post, "/auth/sign-out", RouteClass::Auth, || {
        post(auth::sign_out)
    }),
    Route::new(Verb::Delete, "/account", RouteClass::Auth, || {
        delete(account::delete_account)
    }),
    Route::new(
        Verb::Put,
        "/devices/{installation_id}",
        RouteClass::Write,
        || put(devices::register),
    ),
    Route::new(
        Verb::Delete,
        "/devices/{installation_id}",
        RouteClass::Write,
        || delete(devices::unregister),
    ),
];

/// The route of `table` that answers `method` on `path`, if any.
pub fn find<'a>(table: &'a [Route], method: &Method, path: &str) -> Option<&'a Route> {
    table
        .iter()
        .find(|route| route.verb.matches(method) && route.fits(path))
}

/// Returns the rate-limiting class for a given request path and method (REQ-RL-001).
/// Health routes are exempt.
pub fn route_class(path: &str, method: &Method) -> RouteClass {
    if path.starts_with("/api/health") {
        return RouteClass::Exempt;
    }
    find(&ROUTES, method, path)
        .map(|route| route.class)
        .unwrap_or(RouteClass::Read)
}

/// `path` as it may be logged: a product route's template, so an id in the path (an installation
/// id, REQ-PSH-007) never reaches a log and the field stays bounded; anything else as it came.
/// Anything under the device registry counts as its route, even a path no route fits.
pub fn loggable_path(path: &str) -> Cow<'_, str> {
    if let Some(route) = ROUTES.iter().find(|route| route.fits(path)) {
        return Cow::Owned(route.template());
    }
    let devices = format!("{API_BASE_PATH}{DEVICES_TREE}/");
    match path.starts_with(&devices) {
        true => Cow::Owned(format!("{API_BASE_PATH}{DEVICES_TREE}/{{installation_id}}")),
        false => Cow::Borrowed(path),
    }
}

/// Where the device registry lives below the base path; the segment after it is an installation
/// id.
pub const DEVICES_TREE: &str = "/devices";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_match_whole_segments_only() {
        let route = &ROUTES[2];
        assert_eq!(route.template(), "/api/v1/vote/countries/{code}");
        assert!(route.fits("/api/v1/vote/countries/NP"));
        assert!(!route.fits("/api/v1/vote/countries/"));
        assert!(!route.fits("/api/v1/vote/countries/NP/x"));
        assert!(!route.fits("/api/v1/vote/countries"));
        assert!(!route.fits("/api/vote/countries/NP"));
        assert!(!route.fits("/api/v2/vote/countries/NP"));
        assert_eq!(format!("{route:?}"), "GET /api/v1/vote/countries/{code}");
    }

    // The table is built at compile time; this runs the constructor once (docs/LEARNINGS.md).
    #[test]
    fn the_constructor_starts_undeprecated() {
        let route = Route::new(Verb::Put, "/x/{id}", RouteClass::Write, || {
            put(devices::register)
        });
        assert_eq!(route.deprecated, None);
        assert_eq!(route.class, RouteClass::Write);
        assert_eq!(route.template(), "/api/v1/x/{id}");
        let _router: MethodRouter<AppState> = (route.handler)();
    }

    // Verifies: REQ-RL-001
    #[test]
    fn every_route_has_a_class() {
        for route in &ROUTES {
            assert_ne!(route.class, RouteClass::Exempt);
        }
        assert_eq!(route_class("/api/health", &Method::GET), RouteClass::Exempt);
        assert_eq!(
            route_class("/api/v1/auth/session", &Method::POST),
            RouteClass::Auth
        );
        assert_eq!(
            route_class("/api/v1/auth/session", &Method::GET),
            RouteClass::Read
        );
        assert_eq!(
            route_class("/api/v1/unknown", &Method::GET),
            RouteClass::Read
        );
    }

    #[test]
    fn find_takes_the_method_into_account() {
        let path = "/api/v1/auth/session";
        assert_eq!(find(&ROUTES, &Method::GET, path).unwrap().verb, Verb::Get);
        assert_eq!(find(&ROUTES, &Method::POST, path).unwrap().verb, Verb::Post);
        assert!(find(&ROUTES, &Method::PATCH, path).is_none());
        let verbs: Vec<&str> = [Verb::Get, Verb::Post, Verb::Put, Verb::Delete]
            .map(Verb::as_str)
            .to_vec();
        assert_eq!(verbs, ["GET", "POST", "PUT", "DELETE"]);
    }

    // Verifies: REQ-PSH-007
    #[test]
    fn an_installation_id_never_reaches_a_logged_path() {
        let id = "2f1c7a5e-8b0d-4c3e-9f6a-1d2e3f4a5b6c";
        let template = "/api/v1/devices/{installation_id}";
        assert_eq!(loggable_path(&format!("/api/v1/devices/{id}")), template);
        assert_eq!(
            loggable_path(&format!("/api/v1/devices/{id}/extra")),
            template
        );
        assert_eq!(loggable_path("/api/v1/devices/"), template);
        assert_eq!(loggable_path("/api/v1/devices"), "/api/v1/devices");
        assert_eq!(loggable_path("/api/v1/devicesx"), "/api/v1/devicesx");
        assert_eq!(
            loggable_path("/api/v1/vote/countries/BR"),
            "/api/v1/vote/countries/{code}"
        );
        assert_eq!(loggable_path("/api/health"), "/api/health");
        assert_eq!(loggable_path("/api/v1/nope"), "/api/v1/nope");
    }

    // Verifies: REQ-VER-007
    #[test]
    fn sunset_headers_follow_rfc_9745_and_rfc_8594() {
        let sunset = Sunset {
            deprecated_at: 1_688_169_599,
            sunset_at: 1_798_675_200,
        };
        assert_eq!(sunset.deprecation_header(), "@1688169599");
        assert_eq!(sunset.sunset_header(), "Thu, 31 Dec 2026 00:00:00 GMT");
        assert!(ROUTES.iter().all(|route| route.deprecated.is_none()));
    }
}
