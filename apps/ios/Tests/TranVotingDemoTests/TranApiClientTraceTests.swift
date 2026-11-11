// Verifies: REQ-OBS-010 REQ-OBS-011
import XCTest

/// REQ-OBS-010: Every API call carries a trace; retries and token refresh reuse the trace id.
final class TranApiClientTraceTests: XCTestCase {
    private final class TraceStubURLProtocol: URLProtocol {
        static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
        static var requests: [URLRequest] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Self.requests.append(request)
            guard let handler = Self.handler else {
                client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
                return
            }
            do {
                let (response, data) = try handler(request)
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch {
                client?.urlProtocol(self, didFailWithError: error)
            }
        }

        override func stopLoading() {}
    }

    override func setUp() {
        super.setUp()
        TraceStubURLProtocol.handler = nil
        TraceStubURLProtocol.requests = []
    }

    private static let instantRetry = TranRetry(sleep: { _ in }, random: { 0 })

    private func makeClient() -> TranApiClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TraceStubURLProtocol.self]
        return TranApiClient(
            baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: URLSession(configuration: configuration),
            includeDebugCountry: false,
            retry: Self.instantRetry
        )
    }

    private func respond(status: Int, body: String = "{}") {
        TraceStubURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: [
                    "Content-Type": "application/json",
                ])!
            return (response, Data(body.utf8))
        }
    }

    func testApiCallCarriesValidTraceparentHeader() async throws {
        respond(status: 200)
        try await makeClient().checkHealth()

        XCTAssertEqual(TraceStubURLProtocol.requests.count, 1)
        let request = try XCTUnwrap(TraceStubURLProtocol.requests.first)
        let header = try XCTUnwrap(request.value(forHTTPHeaderField: "traceparent"))
        let parsed = try XCTUnwrap(parseTraceparentOffline(header: header))
        XCTAssertEqual(parsed.traceId.count, 32)
        XCTAssertEqual(parsed.spanId.count, 16)
        XCTAssertTrue(parsed.sampled)
    }

    func testRetryReusesTraceIdWithNewSpanId() async throws {
        var attempts = 0
        TraceStubURLProtocol.handler = { request in
            attempts += 1
            if attempts == 1 {
                let res = HTTPURLResponse(
                    url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
                return (res, Data("{}".utf8))
            }
            let res = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (res, Data("{}".utf8))
        }

        try await makeClient().checkHealth()

        XCTAssertEqual(TraceStubURLProtocol.requests.count, 2)
        let h1 = try XCTUnwrap(TraceStubURLProtocol.requests[0].value(forHTTPHeaderField: "traceparent"))
        let h2 = try XCTUnwrap(TraceStubURLProtocol.requests[1].value(forHTTPHeaderField: "traceparent"))

        let t1 = try XCTUnwrap(parseTraceparentOffline(header: h1))
        let t2 = try XCTUnwrap(parseTraceparentOffline(header: h2))

        // Same trace ID across retries
        XCTAssertEqual(t1.traceId, t2.traceId)
        // Distinct span IDs
        XCTAssertNotEqual(t1.spanId, t2.spanId)
    }

    func testConfirmEligibilitySendsTrace() async throws {
        respond(status: 200)
        try await makeClient().confirmEligibility(age: 21, countryCode: "NP")

        XCTAssertEqual(TraceStubURLProtocol.requests.count, 1)
        let header = try XCTUnwrap(TraceStubURLProtocol.requests[0].value(forHTTPHeaderField: "traceparent"))
        let parsed = try XCTUnwrap(parseTraceparentOffline(header: header))
        XCTAssertEqual(parsed.traceId.count, 32)
    }

    // MARK: - No randomness, no trace

    func testNoRandomnessSendsNoTraceparentRatherThanAConstantOne() {
        let failing: TranRetry.RandomSource = { _ in errSecAllocate }
        XCTAssertNil(TranRetry.newTraceId(random: failing))
        XCTAssertNil(TranRetry.newChildSpan(traceId: nil))
        XCTAssertNil(TranRetry.newChildSpan(traceId: "4bf92f3577b34da6a3ce929d0e0e4736", random: failing))
        // Two real ids never collide.
        XCTAssertNotEqual(TranRetry.newTraceId(), TranRetry.newTraceId())
    }

    // MARK: - A real failed call, reported

    func testAFailedCallWithNoAnswerReportsTheTraceIdItSent() async throws {
        TraceStubURLProtocol.handler = { _ in throw URLError(.unsupportedURL) }
        var reported: TranReporting.Event?
        TranReporting.sink = { event, _ in reported = event }
        defer { TranReporting.sink = nil }

        do {
            try await makeClient().probeHealth()
            XCTFail("expected the call to fail")
        } catch let failure as TranRequestFailure {
            XCTAssertNil(failure.status, "no answer arrived")
            TranReporting.report(failure)
        }

        let sent = try XCTUnwrap(TraceStubURLProtocol.requests.first?.value(forHTTPHeaderField: "traceparent"))
        let traceId = try XCTUnwrap(parseTraceparentOffline(header: sent)?.traceId)
        XCTAssertEqual(reported?.code, "client.unexpected")
        XCTAssertEqual(reported?.traceId, traceId)
        XCTAssertTrue(TranFeedback.logLine(TranRequestFailure.classify(URLError(.unsupportedURL), traceId: traceId))
            .hasSuffix("trace_id=\(traceId)"))
    }

    // MARK: - The session client

    private static let action = "4bf92f3577b34da6a3ce929d0e0e4736"

    private func sessionClient(_ vault: SessionVault) -> TranSessionClient {
        TranSessionClient(
            vault: vault, baseUrl: URL(string: "http://127.0.0.1:3001")!,
            session: SessionStubProtocol.session(), log: { _ in })
    }

    private func traces(_ requests: [SessionStubProtocol.Recorded]) throws -> [TranTraceContext] {
        try requests.map { try XCTUnwrap(parseTraceparentOffline(header: try XCTUnwrap($0.traceparent))) }
    }

    func testARefreshMadeForAnActionReusesItsTraceWithANewSpan() async throws {
        let vault = InMemorySessionVault(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { request in
            request.path == TranEndpoint.refresh.path()
                ? .status(200, body: SessionWire.pair(access: "access-1", refresh: "refresh-1"))
                : .status(204, body: "")
        }

        // No access token after a restart: the action refreshes first, then is sent.
        _ = try await sessionClient(vault).authorized(.validateSession, traceId: Self.action)

        let sent = try traces(SessionStubProtocol.requests)
        XCTAssertEqual(SessionStubProtocol.requests.map(\.path), [TranEndpoint.refresh.path(), TranEndpoint.validateSession.path()])
        XCTAssertEqual(Set(sent.map(\.traceId)), [Self.action], "one action, one trace")
        XCTAssertEqual(Set(sent.map(\.spanId)).count, sent.count, "a new span for each request")
    }

    func testASignOutAfterA401CarriesTheActionTraceId() async throws {
        let vault = InMemorySessionVault(SessionWire.stored(refresh: "refresh-0"))
        SessionStubProtocol.reset { _ in .status(401, body: SessionWire.expired) }

        do {
            _ = try await sessionClient(vault).authorized(.validateSession, traceId: Self.action)
            XCTFail("expected the session to end")
        } catch let failure as TranRequestFailure {
            XCTAssertEqual(failure.untraced, TranSessionClient.expired)
            XCTAssertEqual(failure.traceId, Self.action, "the logged event joins the server's logs")
        }
        XCTAssertEqual(Set(try traces(SessionStubProtocol.requests).map(\.traceId)), [Self.action])
    }
}
