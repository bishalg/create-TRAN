//! The HTTP client the real senders post with (ADR-0046): hyper's client over rustls, trusting
//! Mozilla's root certificates (`webpki-roots`), so the API needs no system certificate store in a
//! container.
//!
//! The base URLs are the senders' to choose; tests point them at a local fake server over plain
//! HTTP, which is why the connector also accepts `http://`. The real URLs are fixed `https://`
//! constants, so nothing in production goes out unencrypted.

use std::time::Duration;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::{Method, Request};
use hyper_rustls::{HttpsConnector, HttpsConnectorBuilder};
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;

/// How long one provider call may take before the send counts as "retry later".
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

/// What came back: the status and the whole body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub body: Bytes,
}

/// Which HTTP versions a client speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    /// HTTP/2 only, as APNs requires; without TLS it starts with HTTP/2 directly (prior knowledge).
    Http2Only,
    /// HTTP/1.1 or HTTP/2, chosen by TLS negotiation (Google).
    Negotiated,
}

/// A pooled client: reuse one per provider, so APNs keeps its one long-lived connection.
#[derive(Clone)]
pub struct HttpClient {
    inner: Client<HttpsConnector<HttpConnector>, Full<Bytes>>,
    timeout: Duration,
}

impl HttpClient {
    pub fn new(protocol: Protocol, timeout: Duration) -> Self {
        let connector = HttpsConnectorBuilder::new()
            .with_webpki_roots()
            .https_or_http();
        let connector = match protocol {
            Protocol::Http2Only => connector.enable_http2().build(),
            Protocol::Negotiated => connector.enable_http1().enable_http2().build(),
        };
        let inner = Client::builder(TokioExecutor::new())
            .http2_only(protocol == Protocol::Http2Only)
            .build(connector);
        Self { inner, timeout }
    }

    /// Posts `body` with `headers` to `url`. `None` when the request could not be made or answered
    /// in time: a transport failure, never logged with its URL (an APNs URL holds the token).
    pub async fn post(&self, url: &str, headers: &[(&str, &str)], body: Vec<u8>) -> Option<Reply> {
        let mut request = Request::builder().method(Method::POST).uri(url);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let request = request.body(Full::new(Bytes::from(body))).ok()?;
        let exchange = async {
            let response = self.inner.request(request).await.ok()?;
            let status = response.status().as_u16();
            let body = response.into_body().collect().await.ok()?.to_bytes();
            Some(Reply { status, body })
        };
        tokio::time::timeout(self.timeout, exchange).await.ok()?
    }
}
