//! Shared by the API integration tests: capture every `tracing` event a request produces.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::fmt::Debug;
use std::sync::{Arc, Mutex};

use tracing::field::{Field, Visit};
use tracing::subscriber::DefaultGuard;
use tracing::Level;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

/// One event: level, message and every field (span fields included) rendered as text.
#[derive(Clone, Debug)]
pub struct Event {
    pub level: Level,
    pub message: String,
    pub fields: BTreeMap<String, String>,
}

impl Event {
    pub fn field(&self, name: &str) -> Option<&str> {
        self.fields.get(name).map(String::as_str)
    }

    /// The whole event as one line, for "must not contain" checks.
    pub fn line(&self) -> String {
        format!("{} {} {:?}", self.level, self.message, self.fields)
    }
}

#[derive(Clone, Default)]
pub struct Captured(Arc<Mutex<Vec<Event>>>);

impl Captured {
    /// Captures on this thread until the guard drops; `#[tokio::test]` is single-threaded.
    pub fn install() -> (Self, DefaultGuard) {
        let captured = Self::default();
        let subscriber = tracing_subscriber::registry().with(captured.clone());
        (captured, tracing::subscriber::set_default(subscriber))
    }

    pub fn events(&self) -> Vec<Event> {
        self.0.lock().unwrap().clone()
    }

    pub fn named(&self, message: &str) -> Vec<Event> {
        self.events()
            .into_iter()
            .filter(|e| e.message == message)
            .collect()
    }
}

#[derive(Default)]
struct Fields(BTreeMap<String, String>);

impl Visit for Fields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().to_string(), value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0.insert(
            field.name().to_string(),
            format!("{value:?}").trim_matches('"').to_string(),
        );
    }
}

/// Span fields, stored on the span so events inside it can report them.
struct SpanFields(BTreeMap<String, String>);

impl<S> Layer<S> for Captured
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        id: &tracing::span::Id,
        ctx: Context<'_, S>,
    ) {
        let mut fields = Fields::default();
        attrs.record(&mut fields);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(SpanFields(fields.0));
        }
    }

    fn on_event(&self, event: &tracing::Event<'_>, ctx: Context<'_, S>) {
        let mut fields = Fields::default();
        if let Some(scope) = ctx.event_scope(event) {
            for span in scope.from_root() {
                if let Some(SpanFields(span_fields)) = span.extensions().get::<SpanFields>() {
                    fields.0.extend(span_fields.clone());
                }
            }
        }
        event.record(&mut fields);
        let message = fields.0.remove("message").unwrap_or_default();
        self.0.lock().unwrap().push(Event {
            level: *event.metadata().level(),
            message,
            fields: fields.0,
        });
    }
}
