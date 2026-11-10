// Verifies: REQ-RL-007
//! Load shedding middleware (spec 031, ADR-0050).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::header::RETRY_AFTER;
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rust_core::feedback::ErrorCode;

use crate::error::ApiError;

/// State for tracking concurrent in-flight requests (REQ-RL-007).
#[derive(Clone)]
pub struct LoadShedState {
    pub in_flight: Arc<AtomicUsize>,
    pub max_in_flight: usize,
}

/// Sheds overload early when concurrent in-flight requests exceed `max_in_flight` (REQ-RL-007).
///
/// Returns `503 server.unavailable` with `Retry-After: 1`, without queueing.
/// Health routes are exempt so an orchestrator can still observe process status.
pub async fn load_shed(
    State(state): State<LoadShedState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if path.starts_with("/api/health") {
        return next.run(request).await;
    }

    let current = state.in_flight.fetch_add(1, Ordering::SeqCst);
    if current >= state.max_in_flight {
        state.in_flight.fetch_sub(1, Ordering::SeqCst);
        let mut response = ApiError::Rejected {
            code: ErrorCode::ServerUnavailable,
            message: "Server is temporarily overloaded".to_string(),
        }
        .into_response();
        response
            .headers_mut()
            .insert(RETRY_AFTER, HeaderValue::from_static("1"));
        return response;
    }

    struct InFlightGuard(Arc<AtomicUsize>);
    impl Drop for InFlightGuard {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    let _guard = InFlightGuard(state.in_flight.clone());
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::middleware::from_fn_with_state;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    // Verifies: REQ-RL-007
    #[tokio::test]
    async fn sheds_overload_past_ceiling_with_503_and_retry_after() {
        let in_flight = Arc::new(AtomicUsize::new(0));
        let state = LoadShedState {
            in_flight: in_flight.clone(),
            max_in_flight: 1,
        };

        let app = Router::new()
            .route("/test", get(|| async { "ok" }))
            .route("/api/health/live", get(|| async { "live" }))
            .layer(from_fn_with_state(state, load_shed));

        // Normal request under ceiling succeeds
        let req0 = Request::builder().uri("/test").body(Body::empty()).unwrap();
        let resp0 = app.clone().oneshot(req0).await.unwrap();
        assert_eq!(resp0.status(), StatusCode::OK);

        // Consume the one permitted slot
        in_flight.store(1, Ordering::SeqCst);

        let req = Request::builder().uri("/test").body(Body::empty()).unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(resp.headers().get(RETRY_AFTER).unwrap(), "1");

        // Health route is exempt
        let health_req = Request::builder()
            .uri("/api/health/live")
            .body(Body::empty())
            .unwrap();
        let health_resp = app.oneshot(health_req).await.unwrap();
        assert_eq!(health_resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn permits_normal_request_under_ceiling() {
        let in_flight = Arc::new(AtomicUsize::new(0));
        let state = LoadShedState {
            in_flight: in_flight.clone(),
            max_in_flight: 5,
        };
        let app = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(from_fn_with_state(state, load_shed));

        let req = Request::builder().uri("/test").body(Body::empty()).unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(in_flight.load(Ordering::SeqCst), 0);
    }
}
