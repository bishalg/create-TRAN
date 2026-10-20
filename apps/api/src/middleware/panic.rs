//! A panic while handling a request answers with the envelope and one `error` event (REQ-ROB-003).
//!
//! [`install_panic_hook`] replaces Rust's stderr print: inside a request it only remembers where the
//! panic happened, so [`panic_response`] can log it once with the request id; outside a request it
//! logs through `tracing` itself.

use std::any::Any;
use std::cell::RefCell;

use axum::response::{IntoResponse, Response};

use crate::error::{ApiError, REQUEST_ID};

thread_local! {
    /// `file:line` of the panic being unwound on this thread, set by the hook.
    static PANIC_LOCATION: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        if REQUEST_ID.try_with(|_| ()).is_ok() {
            let location = info
                .location()
                .map(|l| format!("{}:{}", l.file(), l.line()));
            PANIC_LOCATION.with(|cell| *cell.borrow_mut() = location);
        } else {
            tracing::error!(panic = %info, "panic outside a request");
        }
    }));
}

/// `CatchPanicLayer` handler: the generic 500 envelope; the message and location go to the log.
pub fn panic_response(payload: Box<dyn Any + Send + 'static>) -> Response {
    let message = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".to_string());
    let location = PANIC_LOCATION
        .with(|cell| cell.borrow_mut().take())
        .map(|at| format!(" at {at}"))
        .unwrap_or_default();
    ApiError::Internal(format!("panic{location}: {message}")).into_response()
}
